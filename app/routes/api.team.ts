import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.team";

type FtcEnv = Env & {
	CLERK_SECRET_KEY?: string;
	FTC_API_KEY?: string;
	FTC_API_USERNAME?: string;
	FTC_API_AUTH?: string;
	SCOUTING_DB?: D1Database;
	FTCSCOUT_GRAPHQL_URL?: string;
	FTCSCOUT_API_TOKEN?: string;
};

type FtcResponse<T> = {
	data: T | null;
	status: number;
	warning?: string;
};

const FTC_API_BASE = "https://ftc-api.firstinspires.org/v2.0";
const DEFAULT_SEASON = "2025";

type FtcScoutScores = {
	auto: number | null;
	teleop: number | null;
	endgame: number | null;
	total: number | null;
	penalties: number | null;
	winRate: number | null;
};

async function fetchFtcScout(env: FtcEnv, teamNumber: string, season: string) {
	const emptyScores: FtcScoutScores = { auto: null, teleop: null, endgame: null, total: null, penalties: null, winRate: null };
	if (!env.FTCSCOUT_GRAPHQL_URL || !env.FTCSCOUT_API_TOKEN) {
		return { available: false, scores: emptyScores, warning: "FTCScout is not configured yet." };
	}

	// Keep this adapter isolated until the exact FTCScout schema/query is supplied.
	const query = `query TeamScouting($teamNumber: Int!, $season: String!) { team(teamNumber: $teamNumber, season: $season) { auto teleop endgame total penalties winRate } }`;
	try {
		const response = await fetch(env.FTCSCOUT_GRAPHQL_URL, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${env.FTCSCOUT_API_TOKEN}` },
			body: JSON.stringify({ query, variables: { teamNumber: Number(teamNumber), season } }),
			signal: AbortSignal.timeout(10000),
		});
		const payload = await response.json() as { data?: { team?: Partial<FtcScoutScores> | null }; errors?: { message?: string }[] };
		if (!response.ok || payload.errors?.length || !payload.data?.team) {
			return { available: false, scores: emptyScores, warning: payload.errors?.[0]?.message || `FTCScout returned ${response.status}.` };
		}
		return { available: true, scores: { ...emptyScores, ...payload.data.team }, warning: null };
	} catch (error) {
		return { available: false, scores: emptyScores, warning: `FTCScout request failed: ${error instanceof Error ? error.message : "unknown error"}` };
	}
}

function listFrom<T>(value: Record<string, unknown> | null, key: string): T[] {
	if (!value) return [];
	const list = value[key];
	return Array.isArray(list) ? (list as T[]) : [];
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "private, max-age=300",
		},
	});
}

function getFtcAuthorization(env: FtcEnv) {
	if (env.FTC_API_AUTH) {
		return env.FTC_API_AUTH.startsWith("Basic ")
			? env.FTC_API_AUTH
			: `Basic ${env.FTC_API_AUTH}`;
	}

	if (env.FTC_API_USERNAME && env.FTC_API_KEY) {
		return `Basic ${btoa(`${env.FTC_API_USERNAME}:${env.FTC_API_KEY}`)}`;
	}

	return null;
}

async function authenticate(request: Request, env: FtcEnv) {
	if (!env.CLERK_SECRET_KEY) return null;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

async function getOverrides(db: D1Database | undefined, teamNumber: string, season: string) {
	if (!db || typeof db.prepare !== "function") return {};
	try {
		const result = await db
			.prepare("SELECT field, value, updated_by, updated_by_first_name, updated_by_last_initial, updated_by_account_name FROM team_overrides WHERE team_number = ? AND season = ?")
			.bind(teamNumber, season)
			.all<{ field: string; value: string; updated_by: string; updated_by_first_name: string | null; updated_by_last_initial: string | null; updated_by_account_name: string | null }>();
		return Object.fromEntries(result.results.map((row) => [row.field, {
			value: row.value,
			displayName: row.updated_by_account_name || formatDisplayName(row.updated_by_first_name, row.updated_by_last_initial),
		}]));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not read team overrides", error: error instanceof Error ? error.message : String(error) }));
		return {};
	}
}

async function getSelectedEvents(db: D1Database | undefined, teamNumber: string, season: string) {
	if (!db || typeof db.prepare !== "function") return {};
	try {
		const result = await db.prepare("SELECT event_code, event_name, added_by, added_by_first_name, added_by_last_initial, added_by_account_name FROM selected_events WHERE team_number = ? AND season = ?")
			.bind(teamNumber, season).all<{ event_code: string; event_name: string; added_by: string; added_by_first_name: string | null; added_by_last_initial: string | null; added_by_account_name: string | null }>();
		return Object.fromEntries(result.results.map((row) => [row.event_code, {
			eventName: row.event_name,
			displayName: row.added_by_account_name || formatDisplayName(row.added_by_first_name, row.added_by_last_initial),
		}]));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not read selected events", error: error instanceof Error ? error.message : String(error) }));
		return {};
	}
}

async function getCustomEvents(db: D1Database | undefined, teamNumber: string, season: string) {
	if (!db || typeof db.prepare !== "function") return [];
	try {
		const result = await db.prepare("SELECT event_code, event_name, event_date, created_by, created_by_first_name, created_by_last_initial, created_by_account_name FROM custom_events WHERE team_number = ? AND season = ? ORDER BY event_date IS NULL, event_date, created_at")
			.bind(teamNumber, season).all<{ event_code: string; event_name: string; event_date: string | null; created_by: string; created_by_first_name: string | null; created_by_last_initial: string | null; created_by_account_name: string | null }>();
		return result.results.map((row) => ({
			code: row.event_code,
			name: row.event_name,
			date: row.event_date,
			displayName: row.created_by_account_name || formatDisplayName(row.created_by_first_name, row.created_by_last_initial),
		}));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not read custom events", error: error instanceof Error ? error.message : String(error) }));
		return [];
	}
}

function formatDisplayName(firstName: string | null, lastInitial: string | null) {
	if (firstName) return `${firstName}${lastInitial ? ` ${lastInitial}.` : ""}`;
	return "Account name unavailable";
}

async function getUserIdentity(env: FtcEnv, userId: string) {
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	const firstName = user.firstName?.trim();
	const lastName = user.lastName?.trim();
	if (!firstName || !lastName) throw new Error("Clerk first and last names are required.");
	const lastInitial = user.lastName?.trim().charAt(0) || null;
	const accountName = user.fullName?.trim() || `${firstName} ${lastName}`;
	return { firstName: firstName.slice(0, 100), lastInitial, accountName: accountName.slice(0, 100) };
}

	const EDITABLE_FIELDS = new Set(["notes", "customRating"]);

async function fetchFtc<T>(
	path: string,
	authorization: string,
): Promise<FtcResponse<T>> {
	try {
		const response = await fetch(`${FTC_API_BASE}/${path}`, {
			headers: {
				Accept: "application/json",
				Authorization: authorization,
			},
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return {
				data: null,
				status: response.status,
				warning: `FTC API returned ${response.status} for ${path}`,
			};
		}

		return { data: (await response.json()) as T, status: response.status };
	} catch (error) {
		return {
			data: null,
			status: 502,
			warning: `FTC API request failed for ${path}: ${error instanceof Error ? error.message : "unknown error"}`,
		};
	}
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env as FtcEnv;
	const authorization = getFtcAuthorization(env);
	const teamNumber = params.teamNumber?.trim();
	const url = new URL(request.url);
	const season = url.searchParams.get("season")?.trim() || DEFAULT_SEASON;

	if (!env.CLERK_SECRET_KEY) {
		return json({ error: "Server authentication is not configured." }, 503);
	}

	if (!await authenticate(request, env)) {
		return json({ error: "Authentication required." }, 401);
	}

	if (!authorization) {
		return json({ error: "FTC API credentials are not configured." }, 503);
	}

	if (!teamNumber || !/^\d{1,6}$/.test(teamNumber)) {
		return json({ error: "Enter a valid FTC team number." }, 400);
	}

	const encodedTeamNumber = encodeURIComponent(teamNumber);
	const [team, events, awards] = await Promise.all([
		fetchFtc<Record<string, unknown>>(
			`${season}/teams?teamNumber=${encodedTeamNumber}`,
			authorization,
		),
		fetchFtc<Record<string, unknown>>(
			`${season}/events?teamNumber=${encodedTeamNumber}`,
			authorization,
		),
		fetchFtc<Record<string, unknown>>(
			`${season}/awards/${encodedTeamNumber}`,
			authorization,
		),
	]);

	const eventRecords = listFrom<Record<string, unknown>>(events.data, "events");
	const eventCodes = eventRecords
		.map((event) => event.code)
		.filter((code): code is string => typeof code === "string")
		.slice(0, 20);
	const matchResponses = await Promise.all(
		eventCodes.map((eventCode) =>
			fetchFtc<Record<string, unknown>>(
				`${season}/matches/${encodeURIComponent(eventCode)}?teamNumber=${encodedTeamNumber}`,
				authorization,
			),
		),
	);
	const matches = {
		matches: matchResponses.flatMap((response) => listFrom<Record<string, unknown>>(response.data, "matches")),
	};

	const warnings = [team, events, awards, ...matchResponses]
		.map((result) => result.warning)
		.filter((warning): warning is string => Boolean(warning));

	if (!team.data && team.status === 404) {
		return json({ error: `Team ${teamNumber} was not found for season ${season}.` }, 404);
	}

	const teamRecords = listFrom<Record<string, unknown>>(team.data, "teams");
	const teamProfile = teamRecords[0] || team.data;
	const ftcScout = await fetchFtcScout(env, teamNumber, season);

	return json({
		teamNumber,
		season,
		team: teamProfile,
		events: events.data,
		awards: awards.data,
		matches: matches.data,
		overrides: await getOverrides(env.SCOUTING_DB, teamNumber, season),
		selectedEvents: await getSelectedEvents(env.SCOUTING_DB, teamNumber, season),
		customEvents: await getCustomEvents(env.SCOUTING_DB, teamNumber, season),
		ftcScout,
		warnings,
		meta: {
			fetchedAt: new Date().toISOString(),
			source: "FIRST Tech Challenge API",
			editableFields: [...EDITABLE_FIELDS],
		},
	});
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.cloudflare.env as FtcEnv;
	const teamNumber = params.teamNumber?.trim();
	const url = new URL(request.url);
	const season = url.searchParams.get("season")?.trim() || DEFAULT_SEASON;

	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB || typeof env.SCOUTING_DB.prepare !== "function") {
		return json({ error: "Shared scouting storage is not configured." }, 503);
	}
	if (!teamNumber || !/^\d{1,6}$/.test(teamNumber)) return json({ error: "Enter a valid FTC team number." }, 400);

	let body: { field?: unknown; value?: unknown; eventCode?: unknown; eventName?: unknown; eventDate?: unknown; selected?: unknown };
	try {
		body = (await request.json()) as { field?: unknown; value?: unknown };
	} catch {
		return json({ error: "Invalid edit payload." }, 400);
	}

	if (body.field === "eventSelection") {
		if (typeof body.eventCode !== "string" || typeof body.eventName !== "string" || typeof body.selected !== "boolean") return json({ error: "Invalid event selection." }, 400);
		const identity = await getUserIdentity(env, session.sub);
		if (body.selected) {
			await env.SCOUTING_DB.prepare(`INSERT INTO selected_events (team_number, season, event_code, event_name, added_by, added_by_first_name, added_by_last_initial, added_by_account_name)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(team_number, season, event_code) DO NOTHING`)
				.bind(teamNumber, season, body.eventCode, body.eventName.slice(0, 500), session.sub, identity.firstName, identity.lastInitial, identity.accountName).run();
		} else {
			await env.SCOUTING_DB.prepare("DELETE FROM selected_events WHERE team_number = ? AND season = ? AND event_code = ? AND added_by = ?")
				.bind(teamNumber, season, body.eventCode, session.sub).run();
		}
		return json({ selectedEvents: await getSelectedEvents(env.SCOUTING_DB, teamNumber, season) });
	}

	if (body.field === "customEvent") {
		if (typeof body.eventName !== "string" || !body.eventName.trim() || body.eventName.length > 200) {
			return json({ error: "Enter an event name." }, 400);
		}
		const identity = await getUserIdentity(env, session.sub);
		const eventCode = `custom-${crypto.randomUUID()}`;
		if (body.eventDate !== undefined && (typeof body.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.eventDate))) return json({ error: "Enter a valid event date." }, 400);
		try {
			await env.SCOUTING_DB.prepare(`INSERT INTO custom_events (team_number, season, event_code, event_name, event_date, created_by, created_by_first_name, created_by_last_initial, created_by_account_name)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(team_number, season, event_code) DO UPDATE SET event_name = excluded.event_name, event_date = excluded.event_date`)
				.bind(teamNumber, season, eventCode, body.eventName.trim(), body.eventDate || null, session.sub, identity.firstName, identity.lastInitial, identity.accountName).run();
		} catch (error) {
			return json({ error: `Could not create event: ${error instanceof Error ? error.message : "database error"}` }, 503);
		}
		return json({ customEvents: await getCustomEvents(env.SCOUTING_DB, teamNumber, season) });
	}

	if (typeof body.field !== "string" || !EDITABLE_FIELDS.has(body.field) || typeof body.value !== "string" || body.value.length > 500) {
		return json({ error: "Invalid editable field or value." }, 400);
	}
	const identity = await getUserIdentity(env, session.sub);

	try {
		await env.SCOUTING_DB
			.prepare(`INSERT INTO team_overrides (team_number, season, field, value, updated_by, updated_by_first_name, updated_by_last_initial, updated_by_account_name, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(team_number, season, field) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_by_first_name = excluded.updated_by_first_name, updated_by_last_initial = excluded.updated_by_last_initial, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
			.bind(teamNumber, season, body.field, body.value.trim(), session.sub, identity.firstName, identity.lastInitial, identity.accountName)
			.run();
	} catch (error) {
		return json({ error: `Could not save edit: ${error instanceof Error ? error.message : "database error"}` }, 503);
	}

	return json({ overrides: await getOverrides(env.SCOUTING_DB, teamNumber, season) });
}

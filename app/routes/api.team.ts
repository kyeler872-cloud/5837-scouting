import { createClerkClient, verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.team";
import { cloudflareContext } from "../cloudflare-context";

type FtcEnv = Env & {
	CLERK_SECRET_KEY?: string;
	FTC_API_KEY?: string;
	FTC_API_USERNAME?: string;
	FTC_API_AUTH?: string;
	TBA_AUTH_KEY?: string;
	SCOUTING_DB?: D1Database;
};

type FtcResponse<T> = {
	data: T | null;
	status: number;
	warning?: string;
};

const FTC_API_BASE = "https://ftc-api.firstinspires.org/v2.0";
const TBA_API_BASE = "https://www.thebluealliance.com/api/v3";
const DEFAULT_SEASON = "2025";
type League = "FTC" | "FRC";

function getLeague(url: URL): League | null {
	const league = url.searchParams.get("league")?.trim().toUpperCase() || "FTC";
	return league === "FTC" || league === "FRC" ? league : null;
}

type RobotEntry = {
	id: string;
	name: string;
	description: string;
	imageUrls: RobotImage[];
	startMonth: string;
	endMonth: string | null;
};

type RobotImage = {
	id: string;
	url: string;
	addedBy: string | null;
	displayName: string;
};

function parseRobotImages(value: string): RobotImage[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("Robot image data is invalid.");
	return parsed.map((image: unknown, index): RobotImage => {
		if (typeof image === "string") {
			return { id: `legacy-${index}`, url: image, addedBy: null, displayName: "Contributor unavailable" };
		}
		if (
			typeof image === "object" &&
			image !== null &&
			"id" in image &&
			typeof image.id === "string" &&
			"url" in image &&
			typeof image.url === "string"
		) {
			const addedBy = "addedBy" in image && typeof image.addedBy === "string" ? image.addedBy : null;
			const displayName = "displayName" in image && typeof image.displayName === "string"
				? image.displayName
				: "Contributor unavailable";
			return { id: image.id, url: image.url, addedBy, displayName };
		}
		throw new Error("Robot image data is invalid.");
	});
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

async function getRobots(db: D1Database | undefined, teamNumber: string, season: string): Promise<RobotEntry[]> {
	if (!db || typeof db.prepare !== "function") return [];
	try {
		const result = await db.prepare(`SELECT id, name, description, image_urls, start_month, end_month
			FROM robot_entries WHERE team_number = ? AND season = ?
			ORDER BY (end_month IS NULL) DESC, start_month DESC, created_at DESC`)
			.bind(teamNumber, season)
			.all<{ id: string; name: string; description: string; image_urls: string; start_month: string; end_month: string | null }>();
		return result.results.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			imageUrls: parseRobotImages(row.image_urls),
			startMonth: row.start_month,
			endMonth: row.end_month,
		}));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not read robot entries", error: error instanceof Error ? error.message : String(error) }));
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

const EDITABLE_FIELDS = new Set(["autoNotes", "teleopNotes"]);

function averageAllianceScore(matches: Record<string, unknown>[], teamNumber: string, phase: "Auto" | "Teleop") {
	const scores: number[] = [];
	for (const match of matches) {
		const teams = Array.isArray(match.teams) ? match.teams as Record<string, unknown>[] : [];
		const assignment = teams.find((team) => String(team.teamNumber) === teamNumber);
		const station = typeof assignment?.station === "string" ? assignment.station.toLowerCase() : "";
		const alliance = station.startsWith("red") ? "Red" : station.startsWith("blue") ? "Blue" : null;
		if (!alliance) continue;
		const score = match[`score${alliance}${phase}`];
		if (typeof score === "number" && Number.isFinite(score) && score >= 0) scores.push(score);
	}
	return {
		average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : null,
		matchCount: scores.length,
	};
}

function averageFrcScore(matches: Record<string, unknown>[], teamKey: string, phase: "autoPoints" | "teleopPoints") {
	const scores: number[] = [];
	for (const match of matches) {
		const alliances = typeof match.alliances === "object" && match.alliances !== null
			? match.alliances as Record<string, unknown>
			: {};
		const breakdown = typeof match.score_breakdown === "object" && match.score_breakdown !== null
			? match.score_breakdown as Record<string, unknown>
			: {};
		for (const color of ["red", "blue"]) {
			const alliance = typeof alliances[color] === "object" && alliances[color] !== null
				? alliances[color] as Record<string, unknown>
				: {};
			const teams = Array.isArray(alliance.team_keys) ? alliance.team_keys : [];
			if (!teams.includes(teamKey)) continue;
			const allianceScore = typeof breakdown[color] === "object" && breakdown[color] !== null
				? breakdown[color] as Record<string, unknown>
				: {};
			const score = allianceScore[phase] ?? allianceScore[phase === "autoPoints" ? "auto_points" : "teleop_points"];
			if (typeof score === "number" && Number.isFinite(score) && score >= 0) scores.push(score);
		}
	}
	return {
		average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : null,
		matchCount: scores.length,
	};
}

function validMonth(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validImageUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

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

async function fetchTba<T>(path: string, authKey: string): Promise<FtcResponse<T>> {
	try {
		const response = await fetch(`${TBA_API_BASE}/${path}`, {
			headers: {
				Accept: "application/json",
				"X-TBA-Auth-Key": authKey,
			},
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			return {
				data: null,
				status: response.status,
				warning: `The Blue Alliance API returned ${response.status} for ${path}`,
			};
		}
		return { data: (await response.json()) as T, status: response.status };
	} catch (error) {
		return {
			data: null,
			status: 502,
			warning: `The Blue Alliance API request failed for ${path}: ${error instanceof Error ? error.message : "unknown error"}`,
		};
	}
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as FtcEnv;
	const teamNumber = params.teamNumber?.trim();
	const url = new URL(request.url);
	const season = url.searchParams.get("season")?.trim() || DEFAULT_SEASON;
	const league = getLeague(url);
	const tbaAuthKey = env.TBA_AUTH_KEY;

	if (!env.CLERK_SECRET_KEY) {
		return json({ error: "Server authentication is not configured." }, 503);
	}

	if (!await authenticate(request, env)) {
		return json({ error: "Authentication required." }, 401);
	}

	if (!league) return json({ error: "Choose FTC or FRC." }, 400);
	if (league === "FTC" && !getFtcAuthorization(env)) {
		return json({ error: "FTC API credentials are not configured." }, 503);
	}
	if (league === "FRC" && !tbaAuthKey) {
		return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
	}

	if (!teamNumber || !/^\d{1,6}$/.test(teamNumber)) {
		return json({ error: `Enter a valid ${league} team number.` }, 400);
	}

	const dbTeamNumber = league === "FRC" ? `frc:${teamNumber}` : teamNumber;
	let teamProfile: Record<string, unknown> | null = null;
	let eventsData: Record<string, unknown> | Record<string, unknown>[] | null = null;
	let awardsData: Record<string, unknown> | Record<string, unknown>[] | null = null;
	let matchesData: Record<string, unknown>[] = [];
	let warnings: string[] = [];
	let auto: { average: string | null; matchCount: number };
	let teleop: { average: string | null; matchCount: number };

	if (league === "FTC") {
		const authorization = getFtcAuthorization(env);
		if (!authorization) return json({ error: "FTC API credentials are not configured." }, 503);
		const encodedTeamNumber = encodeURIComponent(teamNumber);
		const [team, events, awards] = await Promise.all([
			fetchFtc<Record<string, unknown>>(`${season}/teams?teamNumber=${encodedTeamNumber}`, authorization),
			fetchFtc<Record<string, unknown>>(`${season}/events?teamNumber=${encodedTeamNumber}`, authorization),
			fetchFtc<Record<string, unknown>>(`${season}/awards/${encodedTeamNumber}`, authorization),
		]);
		const eventRecords = listFrom<Record<string, unknown>>(events.data, "events");
		const eventCodes = eventRecords
			.map((event) => event.code)
			.filter((code): code is string => typeof code === "string")
			.slice(0, 20);
		const matchResponses = await Promise.all(eventCodes.map((eventCode) =>
			fetchFtc<Record<string, unknown>>(`${season}/matches/${encodeURIComponent(eventCode)}?teamNumber=${encodedTeamNumber}`, authorization),
		));
		matchesData = matchResponses.flatMap((response) => listFrom<Record<string, unknown>>(response.data, "matches"));
		warnings = [team, events, awards, ...matchResponses]
			.map((response) => response.warning)
			.filter((warning): warning is string => Boolean(warning));
		if (!team.data && team.status === 404) return json({ error: `FTC team ${teamNumber} was not found for season ${season}.` }, 404);
		const teamRecords = listFrom<Record<string, unknown>>(team.data, "teams");
		teamProfile = teamRecords[0] || team.data;
		eventsData = events.data;
		awardsData = awards.data;
		auto = averageAllianceScore(matchesData, teamNumber, "Auto");
		teleop = averageAllianceScore(matchesData, teamNumber, "Teleop");
	} else {
		if (!tbaAuthKey) return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
		const teamKey = `frc${teamNumber}`;
		const encodedTeamKey = encodeURIComponent(teamKey);
		const year = encodeURIComponent(season);
		const [team, events, awards, matches] = await Promise.all([
			fetchTba<Record<string, unknown>>(`team/${encodedTeamKey}`, tbaAuthKey),
			fetchTba<Record<string, unknown>[]>(`team/${encodedTeamKey}/events/${year}`, tbaAuthKey),
			fetchTba<Record<string, unknown>[]>(`team/${encodedTeamKey}/awards/${year}`, tbaAuthKey),
			fetchTba<Record<string, unknown>[]>(`team/${encodedTeamKey}/matches/${year}`, tbaAuthKey),
		]);
		if (team.status === 401 || team.status === 403) {
			return json({ error: "The Blue Alliance rejected the configured API key. Check the TBA_AUTH_KEY Worker secret." }, 503);
		}
		if (!team.data && team.status === 404) return json({ error: `FRC team ${teamNumber} was not found.` }, 404);
		teamProfile = team.data;
		eventsData = events.data;
		awardsData = awards.data;
		matchesData = matches.data || [];
		warnings = [team, events, awards, matches]
			.map((response) => response.warning)
			.filter((warning): warning is string => Boolean(warning));
		auto = averageFrcScore(matchesData, teamKey, "autoPoints");
		teleop = averageFrcScore(matchesData, teamKey, "teleopPoints");
	}

	return json({
		league,
		teamNumber,
		season,
		team: teamProfile,
		events: eventsData,
		awards: awardsData,
		matches: matchesData,
		overrides: await getOverrides(env.SCOUTING_DB, dbTeamNumber, season),
		selectedEvents: await getSelectedEvents(env.SCOUTING_DB, dbTeamNumber, season),
		customEvents: await getCustomEvents(env.SCOUTING_DB, dbTeamNumber, season),
		performance: { auto, teleop },
		robots: await getRobots(env.SCOUTING_DB, dbTeamNumber, season),
		warnings,
		meta: {
			fetchedAt: new Date().toISOString(),
			source: league === "FTC" ? "FIRST Tech Challenge API" : "The Blue Alliance API v3",
			editableFields: [...EDITABLE_FIELDS],
		},
	});
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as FtcEnv;
	const teamNumber = params.teamNumber?.trim();
	const url = new URL(request.url);
	const season = url.searchParams.get("season")?.trim() || DEFAULT_SEASON;
	const league = getLeague(url);

	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB || typeof env.SCOUTING_DB.prepare !== "function") {
		return json({ error: "Shared scouting storage is not configured." }, 503);
	}
	if (!league) return json({ error: "Choose FTC or FRC." }, 400);
	if (!teamNumber || !/^\d{1,6}$/.test(teamNumber)) return json({ error: `Enter a valid ${league} team number.` }, 400);
	const dbTeamNumber = league === "FRC" ? `frc:${teamNumber}` : teamNumber;

	let body: { field?: unknown; value?: unknown; eventCode?: unknown; eventName?: unknown; eventDate?: unknown; selected?: unknown; robotId?: unknown; robotName?: unknown; description?: unknown; imageUrls?: unknown; startMonth?: unknown; endMonth?: unknown };
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
				.bind(dbTeamNumber, season, body.eventCode, body.eventName.slice(0, 500), session.sub, identity.firstName, identity.lastInitial, identity.accountName).run();
		} else {
			await env.SCOUTING_DB.prepare("DELETE FROM selected_events WHERE team_number = ? AND season = ? AND event_code = ? AND added_by = ?")
				.bind(dbTeamNumber, season, body.eventCode, session.sub).run();
		}
		return json({ selectedEvents: await getSelectedEvents(env.SCOUTING_DB, dbTeamNumber, season) });
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
				.bind(dbTeamNumber, season, eventCode, body.eventName.trim(), body.eventDate || null, session.sub, identity.firstName, identity.lastInitial, identity.accountName).run();
		} catch (error) {
			return json({ error: `Could not create event: ${error instanceof Error ? error.message : "database error"}` }, 503);
		}
		return json({ customEvents: await getCustomEvents(env.SCOUTING_DB, dbTeamNumber, season) });
	}

	if (body.field === "robot") {
		if (body.robotId !== undefined && (typeof body.robotId !== "string" || !body.robotId || body.robotId.length > 100)) return json({ error: "Invalid robot entry." }, 400);
		if (typeof body.robotName !== "string" || !body.robotName.trim() || body.robotName.trim().length > 120) return json({ error: "Enter a robot name (up to 120 characters)." }, 400);
		if (typeof body.description !== "string" || body.description.length > 2000) return json({ error: "Robot description must be 2,000 characters or fewer." }, 400);
		if (!validMonth(body.startMonth)) return json({ error: "Choose a valid robot start month." }, 400);
		if (body.endMonth !== null && body.endMonth !== "" && !validMonth(body.endMonth)) return json({ error: "Choose a valid robot end month." }, 400);
		const endMonth = typeof body.endMonth === "string" && body.endMonth ? body.endMonth : null;
		if (endMonth && endMonth < body.startMonth) return json({ error: "Robot end month cannot be before its start month." }, 400);
		if (!Array.isArray(body.imageUrls) || body.imageUrls.length > 8 || !body.imageUrls.every((image) =>
			typeof image === "object" &&
			image !== null &&
			"id" in image &&
			typeof image.id === "string" &&
			image.id.length > 0 &&
			image.id.length <= 100 &&
			"url" in image &&
			validImageUrl(image.url)
		)) return json({ error: "Add up to 8 valid image URLs using http or https." }, 400);
		const submittedImages = body.imageUrls as { id: string; url: string }[];
		if (new Set(submittedImages.map((image) => image.id)).size !== submittedImages.length) return json({ error: "Robot photos must have unique IDs." }, 400);

		try {
			if (typeof body.robotId === "string") {
				const existing = await env.SCOUTING_DB.prepare("SELECT image_urls FROM robot_entries WHERE id = ? AND team_number = ? AND season = ?")
					.bind(body.robotId, dbTeamNumber, season)
					.first<{ image_urls: string }>();
				if (!existing) return json({ error: "Robot entry not found." }, 404);
				const existingImages = parseRobotImages(existing.image_urls);
				const existingById = new Map(existingImages.map((image) => [image.id, image]));
				const identity = await getUserIdentity(env, session.sub);
				const images: RobotImage[] = submittedImages.map((image) => {
					const savedImage = existingById.get(image.id);
					if (savedImage) return { ...savedImage, url: image.url };
					return {
						id: image.id,
						url: image.url,
						addedBy: session.sub,
						displayName: identity.accountName,
					};
				});
				const result = await env.SCOUTING_DB.prepare(`UPDATE robot_entries
					SET name = ?, description = ?, image_urls = ?, start_month = ?, end_month = ?
					WHERE id = ? AND team_number = ? AND season = ?`)
					.bind(body.robotName.trim(), body.description.trim(), JSON.stringify(images), body.startMonth, endMonth, body.robotId, dbTeamNumber, season)
					.run();
				if (!result.meta.changes) return json({ error: "Robot entry not found." }, 404);
			} else {
				await env.SCOUTING_DB.prepare(`INSERT INTO robot_entries (id, team_number, season, name, description, image_urls, start_month, end_month)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
					.bind(crypto.randomUUID(), dbTeamNumber, season, body.robotName.trim(), body.description.trim(), JSON.stringify([]), body.startMonth, endMonth)
					.run();
			}
		} catch (error) {
			return json({ error: `Could not ${body.robotId ? "update" : "save"} robot: ${error instanceof Error ? error.message : "database error"}` }, 503);
		}
		return json({ robots: await getRobots(env.SCOUTING_DB, dbTeamNumber, season) });
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
			.bind(dbTeamNumber, season, body.field, body.value.trim(), session.sub, identity.firstName, identity.lastInitial, identity.accountName)
			.run();
	} catch (error) {
		return json({ error: `Could not save edit: ${error instanceof Error ? error.message : "database error"}` }, 503);
	}

	return json({ overrides: await getOverrides(env.SCOUTING_DB, dbTeamNumber, season) });
}

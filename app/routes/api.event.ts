import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.event";
import { cloudflareContext } from "../cloudflare-context";
import { auditStatement, getAuditActor } from "../audit.server";

type League = "FTC" | "FRC";
type ApiObject = Record<string, unknown>;
type EventTeam = { number: string; name: string; manual: boolean };
type EventEnv = Env & {
	CLERK_SECRET_KEY?: string;
	FTC_API_AUTH?: string;
	FTC_API_USERNAME?: string;
	FTC_API_KEY?: string;
	TBA_AUTH_KEY?: string;
	SCOUTING_DB?: D1Database;
};

const FTC_API_BASE = "https://ftc-api.firstinspires.org/v2.0";
const TBA_API_BASE = "https://www.thebluealliance.com/api/v3";
const NOTE_CATEGORIES = ["Matches", "Playoffs", "Notes"] as const;

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
	});
}

function getFtcAuthorization(env: EventEnv) {
	if (env.FTC_API_AUTH) return env.FTC_API_AUTH.startsWith("Basic ") ? env.FTC_API_AUTH : `Basic ${env.FTC_API_AUTH}`;
	if (env.FTC_API_USERNAME && env.FTC_API_KEY) return `Basic ${btoa(`${env.FTC_API_USERNAME}:${env.FTC_API_KEY}`)}`;
	return null;
}

async function authenticate(request: Request, env: EventEnv) {
	if (!env.CLERK_SECRET_KEY) return null;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

async function fetchJson<T>(url: string, headers: HeadersInit) {
	try {
		const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
		if (!response.ok) return { data: null as T | null, warning: `Event data provider returned ${response.status}.` };
		return { data: await response.json() as T, warning: null };
	} catch (error) {
		return { data: null as T | null, warning: `Event data request failed: ${error instanceof Error ? error.message : "unknown error"}` };
	}
}

function records(value: unknown, key: string): ApiObject[] {
	if (typeof value !== "object" || value === null || !(key in value)) return [];
	const result = (value as Record<string, unknown>)[key];
	return Array.isArray(result) ? result as ApiObject[] : [];
}

function stringField(record: ApiObject, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return "";
}

function validPhotoUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2048) return false;
	if (!value) return true;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function dbTeamNumber(league: League, number: string) {
	return league === "FRC" ? `frc:${number}` : number;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as EventEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	if (!await authenticate(request, env)) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	const league = params.league?.toUpperCase();
	const season = params.season || "";
	const eventCode = params.eventCode || "";
	if (league !== "FTC" && league !== "FRC") return json({ error: "Choose FTC or FRC." }, 400);
	if (!/^\d{4}$/.test(season) || Number(season) < 1992 || Number(season) > 2100) return json({ error: "Choose a valid season." }, 400);
	if (!/^[a-zA-Z0-9_-]{1,120}$/.test(eventCode)) return json({ error: "Invalid event code." }, 400);

	let event: ApiObject | null = null;
	let teams: EventTeam[] = [];
	let warning: string | null = null;
	const custom = eventCode.startsWith("custom-");
	if (custom) {
		const leagueTeamPredicate = league === "FRC" ? "team_number LIKE 'frc:%'" : "team_number NOT LIKE 'frc:%'";
		const records = await env.SCOUTING_DB.prepare(
			`SELECT team_number, event_name, event_date FROM custom_events WHERE event_code = ? AND season = ? AND ${leagueTeamPredicate} ORDER BY created_at`,
		).bind(eventCode, season).all<{
			team_number: string;
			event_name: string;
			event_date: string | null;
		}>();
		if (!records.results.length) return json({ error: "Event not found." }, 404);
		const first = records.results[0];
		event = {
			code: eventCode,
			key: eventCode,
			name: first.event_name,
			dateStart: first.event_date,
			dateEnd: first.event_date,
			start_date: first.event_date,
			end_date: first.event_date,
		};
		teams = records.results.map((record) => ({
			number: record.team_number.replace(/^frc:/, ""),
			name: "",
			manual: false,
		}));
	} else if (league === "FTC") {
		const authorization = getFtcAuthorization(env);
		if (!authorization) return json({ error: "FTC API credentials are not configured." }, 503);
		const [eventResult, teamsResult] = await Promise.all([
			fetchJson<ApiObject>(`${FTC_API_BASE}/${season}/events?eventCode=${encodeURIComponent(eventCode)}`, {
				Accept: "application/json",
				Authorization: authorization,
			}),
			fetchJson<ApiObject>(`${FTC_API_BASE}/${season}/teams?eventCode=${encodeURIComponent(eventCode)}`, {
				Accept: "application/json",
				Authorization: authorization,
			}),
		]);
		event = records(eventResult.data, "events")[0] || null;
		teams = records(teamsResult.data, "teams").map((team) => ({
			number: stringField(team, ["teamNumber"]),
			name: stringField(team, ["nameShort", "nameLong", "name"]),
			manual: false,
		})).filter((team) => Boolean(team.number));
		warning = [eventResult.warning, teamsResult.warning].filter(Boolean).join(" ") || null;
		if (!event) return json({ error: warning || "Event not found in the FIRST API." }, warning ? 502 : 404);
	} else {
		if (!env.TBA_AUTH_KEY) return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
		const [eventResult, teamsResult] = await Promise.all([
			fetchJson<ApiObject>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}`, {
				Accept: "application/json",
				"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
			}),
			fetchJson<ApiObject[]>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}/teams`, {
				Accept: "application/json",
				"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
			}),
		]);
		event = eventResult.data;
		teams = (teamsResult.data || []).map((team) => ({
			number: stringField(team, ["team_number", "key"]).replace(/^frc/, ""),
			name: stringField(team, ["nickname", "name"]),
			manual: false,
		})).filter((team) => Boolean(team.number));
		warning = [eventResult.warning, teamsResult.warning].filter(Boolean).join(" ") || null;
		if (!event) return json({ error: warning || "Event not found in The Blue Alliance." }, warning ? 502 : 404);
	}

	const [notes, assets, manualTeams] = await Promise.all([
		env.SCOUTING_DB.prepare("SELECT category, note, updated_by_account_name FROM event_notes WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).all<{ category: string; note: string; updated_by_account_name: string }>(),
		env.SCOUTING_DB.prepare("SELECT photos_url FROM event_assets WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).first<{ photos_url: string }>(),
		env.SCOUTING_DB.prepare("SELECT team_number, team_name FROM event_manual_teams WHERE league = ? AND season = ? AND event_code = ? ORDER BY team_number")
			.bind(league, season, eventCode).all<{ team_number: string; team_name: string }>(),
	]);
	for (const team of manualTeams.results) {
		const existing = teams.find((item) => item.number === team.team_number);
		if (existing) {
			if (team.team_name) existing.name = team.team_name;
		} else {
			teams.push({ number: team.team_number, name: team.team_name, manual: true });
		}
	}

	return json({
		league,
		season,
		eventCode,
		event: {
			name: stringField(event, ["name", "eventName"]) || eventCode,
			startDate: stringField(event, league === "FTC" ? ["dateStart", "start_date"] : ["start_date"]) || null,
			endDate: stringField(event, league === "FTC" ? ["dateEnd", "end_date"] : ["end_date"]) || null,
			city: stringField(event, ["city"]),
			state: stringField(event, ["stateProv", "state_prov"]),
			country: stringField(event, ["country"]),
			region: stringField(event, ["regionCode", "region"]),
			custom,
		},
		teams: teams.sort((a, b) => Number(a.number) - Number(b.number)),
		notes: Object.fromEntries(notes.results.map((note) => [note.category, { value: note.note, displayName: note.updated_by_account_name }])),
		photosUrl: assets?.photos_url || "",
		warning,
	});
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as EventEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	const league = params.league?.toUpperCase();
	const season = params.season || "";
	const eventCode = params.eventCode || "";
	if ((league !== "FTC" && league !== "FRC") || !/^\d{4}$/.test(season) || !/^[a-zA-Z0-9_-]{1,120}$/.test(eventCode)) {
		return json({ error: "Invalid event." }, 400);
	}
	let body: { action?: unknown; category?: unknown; note?: unknown; photosUrl?: unknown; teamNumber?: unknown; teamName?: unknown };
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid event edit payload." }, 400);
	}

	try {
		const actor = await getAuditActor(env, session.sub);
		const displayName = actor.accountName;
		if (body.action === "note") {
			if (typeof body.category !== "string" || !NOTE_CATEGORIES.includes(body.category as typeof NOTE_CATEGORIES[number])) return json({ error: "Choose a valid note category." }, 400);
			if (typeof body.note !== "string" || body.note.length > 10000) return json({ error: "Notes must be 10,000 characters or fewer." }, 400);
			const previous = await env.SCOUTING_DB.prepare("SELECT note FROM event_notes WHERE league = ? AND season = ? AND event_code = ? AND category = ?")
				.bind(league, season, eventCode, body.category).first<{ note: string }>();
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare(`INSERT INTO event_notes (league, season, event_code, category, note, updated_by, updated_by_account_name, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(league, season, event_code, category) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
					.bind(league, season, eventCode, body.category, body.note.trim(), session.sub, displayName),
				auditStatement(env.SCOUTING_DB, actor, "Updated event notes", `${league} ${season} / ${eventCode}: ${body.category}`,
					previous?.note ?? null, body.note.trim()),
			]);
			return json({ category: body.category, note: { value: body.note.trim(), displayName } });
		}
		if (body.action === "photos") {
			if (!validPhotoUrl(body.photosUrl)) return json({ error: "Enter a valid http or https photos link." }, 400);
			const previous = await env.SCOUTING_DB.prepare("SELECT photos_url FROM event_assets WHERE league = ? AND season = ? AND event_code = ?")
				.bind(league, season, eventCode).first<{ photos_url: string }>();
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare(`INSERT INTO event_assets (league, season, event_code, photos_url, updated_by, updated_by_account_name, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(league, season, event_code) DO UPDATE SET photos_url = excluded.photos_url, updated_by = excluded.updated_by, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
					.bind(league, season, eventCode, body.photosUrl.trim(), session.sub, displayName),
				auditStatement(env.SCOUTING_DB, actor, "Updated event photos link", `${league} ${season} / ${eventCode}`,
					previous?.photos_url ?? null, body.photosUrl.trim()),
			]);
			return json({ photosUrl: body.photosUrl.trim() });
		}
		if (body.action === "add-team") {
			const leagueTeamPredicate = league === "FRC" ? "team_number LIKE 'frc:%'" : "team_number NOT LIKE 'frc:%'";
			const customEvent = await env.SCOUTING_DB.prepare(
				`SELECT 1 AS found FROM custom_events WHERE event_code = ? AND season = ? AND ${leagueTeamPredicate} LIMIT 1`,
			).bind(eventCode, season).first<{ found: number }>();
			if (!customEvent) return json({ error: "Teams can only be imported manually into custom events." }, 400);
			if (typeof body.teamNumber !== "string" || !/^\d{1,6}$/.test(body.teamNumber.trim())) return json({ error: `Enter a valid ${league} team number.` }, 400);
			if (body.teamName !== undefined && (typeof body.teamName !== "string" || body.teamName.length > 200)) return json({ error: "Team names must be 200 characters or fewer." }, 400);
			const teamNumber = body.teamNumber.trim();
			const previous = await env.SCOUTING_DB.prepare("SELECT team_name FROM event_manual_teams WHERE league = ? AND season = ? AND event_code = ? AND team_number = ?")
				.bind(league, season, eventCode, teamNumber).first<{ team_name: string }>();
			const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare(`INSERT INTO event_manual_teams (league, season, event_code, team_number, team_name, added_by, added_by_account_name)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(league, season, event_code, team_number) DO UPDATE SET team_name = excluded.team_name`)
					.bind(league, season, eventCode, teamNumber, teamName, session.sub, displayName),
				auditStatement(env.SCOUTING_DB, actor, previous ? "Updated custom event team" : "Added team to custom event", `${league} ${season} / ${eventCode}: team ${teamNumber}`,
					previous?.team_name ?? null, teamName),
			]);
			return json({ ok: true });
		}
		if (body.action === "remove-team") {
			const leagueTeamPredicate = league === "FRC" ? "team_number LIKE 'frc:%'" : "team_number NOT LIKE 'frc:%'";
			const customEvent = await env.SCOUTING_DB.prepare(
				`SELECT 1 AS found FROM custom_events WHERE event_code = ? AND season = ? AND ${leagueTeamPredicate} LIMIT 1`,
			).bind(eventCode, season).first<{ found: number }>();
			if (!customEvent) return json({ error: "Teams can only be removed from custom events." }, 400);
			if (typeof body.teamNumber !== "string" || !/^\d{1,6}$/.test(body.teamNumber)) return json({ error: "Invalid team number." }, 400);
			const previous = await env.SCOUTING_DB.prepare("SELECT team_name FROM event_manual_teams WHERE league = ? AND season = ? AND event_code = ? AND team_number = ?")
				.bind(league, season, eventCode, body.teamNumber).first<{ team_name: string }>();
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare("DELETE FROM event_manual_teams WHERE league = ? AND season = ? AND event_code = ? AND team_number = ?")
					.bind(league, season, eventCode, body.teamNumber),
				auditStatement(env.SCOUTING_DB, actor, "Removed team from custom event", `${league} ${season} / ${eventCode}: team ${body.teamNumber}`,
					previous?.team_name ?? null, null),
			]);
			return json({ ok: true });
		}
		return json({ error: "Choose a valid event edit." }, 400);
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not save event changes", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: `Could not save event changes: ${error instanceof Error ? error.message : "database error"}` }, 503);
	}
}

import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.event";
import { cloudflareContext } from "../cloudflare-context";
import { auditStatement, getAuditActor, getLocalContributorName } from "../audit.server";

type League = "FTC" | "FRC";
type ApiObject = Record<string, unknown>;
type EventTeam = { number: string; name: string; manual: boolean };
type MatchPhase = "Auto" | "TeleOp" | "Endgame";
type AutoPoint = { x: number; y: number };
type AutoPath = { points: AutoPoint[]; controls: AutoPoint[] };
type CompatibilityWeights = {
	flowerCapability: number;
	flowerTakeFrom: number;
	flowerInputInto: number;
	hiveCapability: number;
	hivePosition: number;
	hiveShooterType: number;
};
type EventMatch = {
	matchKey: string;
	qualificationNumber: number;
	teams: string[];
	redTeams: string[];
	blueTeams: string[];
	scheduledTime: string | null;
	redScore: number | null;
	blueScore: number | null;
	completed: boolean;
	prediction: { redScore: number | null; blueScore: number | null; redWinProbability: number | null };
	notes: Partial<Record<MatchPhase, { value: string; displayName: string }>>;
	autoPath?: { path: AutoPath; displayName: string } | null;
	autoSelections?: EventAutoSelection[];
};
type EventAuto = { id: string; name: string; alliance: "red" | "blue"; score: number | null; path: AutoPath };
type EventAutoSelection = {
	teamNumber: string;
	robotId: string;
	autoId: string;
	autoName: string;
	path: AutoPath;
	displayName: string;
};
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
const MATCH_PHASES: MatchPhase[] = ["Auto", "TeleOp", "Endgame"];
const EMPTY_AUTO_PATH: AutoPath = { points: [], controls: [] };
const DEFAULT_COMPATIBILITY_WEIGHTS: CompatibilityWeights = {
	flowerCapability: 50,
	flowerTakeFrom: 50,
	flowerInputInto: 50,
	hiveCapability: 50,
	hivePosition: 50,
	hiveShooterType: 50,
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
	});
}

function parseAutoPath(value: unknown): AutoPath | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.points) || !Array.isArray(record.controls) ||
		record.points.length > 100 || record.controls.length !== Math.max(0, record.points.length - 1)) return null;
	const validPoint = (point: unknown): point is AutoPoint =>
		typeof point === "object" && point !== null &&
		"x" in point && typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1000 &&
		"y" in point && typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1000;
	if (!record.points.every(validPoint) || !record.controls.every(validPoint)) return null;
	return { points: record.points, controls: record.controls };
}

function parseRobotAutos(value: string): EventAuto[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("Robot autonomous data is invalid.");
	return parsed.map((item) => {
		if (typeof item !== "object" || item === null) throw new Error("Robot autonomous data is invalid.");
		const auto = item as Record<string, unknown>;
		const path = parseAutoPath(auto.path);
		if (
			typeof auto.id !== "string" ||
			typeof auto.name !== "string" ||
			(auto.alliance !== "red" && auto.alliance !== "blue") ||
			(auto.score !== null && (typeof auto.score !== "number" || !Number.isFinite(auto.score))) ||
			!path
		) throw new Error("Robot autonomous data is invalid.");
		return { id: auto.id, name: auto.name, alliance: auto.alliance, score: auto.score as number | null, path };
	});
}

async function getQualificationMatch(
	env: EventEnv,
	league: League,
	season: string,
	eventCode: string,
	matchKey: string,
): Promise<Omit<EventMatch, "notes"> | null> {
	let scheduleData: ApiObject[] | null = null;
	if (league === "FTC") {
		const authorization = getFtcAuthorization(env);
		if (!authorization) throw new Error("FTC API credentials are not configured.");
		const result = await fetchJson<ApiObject>(`${FTC_API_BASE}/${season}/schedule/${encodeURIComponent(eventCode)}/qual/hybrid`, {
			Accept: "application/json",
			Authorization: authorization,
		});
		if (!result.data) throw new Error(result.warning || "Could not verify the qualification schedule.");
		scheduleData = records(result.data, "schedule");
	} else {
		if (!env.TBA_AUTH_KEY) throw new Error("The Blue Alliance API key is not configured on the server.");
		const result = await fetchJson<ApiObject[]>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}/matches`, {
			Accept: "application/json",
			"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
		});
		if (!result.data) throw new Error(result.warning || "Could not verify the qualification schedule.");
		scheduleData = result.data;
	}
	return qualificationMatches(scheduleData, league).find((match) => match.matchKey === matchKey) || null;
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

function qualificationMatches(value: ApiObject[] | null, league: League): Omit<EventMatch, "notes">[] {
	return (value || []).flatMap((match) => {
		let qualificationNumber = 0;
		let teams: string[] = [];
		let redTeams: string[] = [];
		let blueTeams: string[] = [];
		let scheduledTime = "";
		let redScore: number | null = null;
		let blueScore: number | null = null;
		if (league === "FTC") {
			const level = stringField(match, ["tournamentLevel"]).toLowerCase();
			if (level && !level.includes("qual")) return [];
			qualificationNumber = Number(match.matchNumber);
			const assignments = Array.isArray(match.teams) ? match.teams as ApiObject[] : [];
			for (const assignment of assignments) {
				const teamNumber = stringField(assignment, ["teamNumber"]);
				const station = stringField(assignment, ["station"]).toLowerCase();
				if (!teamNumber) continue;
				teams.push(teamNumber);
				if (station.startsWith("red")) redTeams.push(teamNumber);
				if (station.startsWith("blue")) blueTeams.push(teamNumber);
			}
			scheduledTime = stringField(match, ["scheduledStartTime", "actualStartTime"]);
			redScore = nonnegativeScore(match.scoreRedFinal);
			blueScore = nonnegativeScore(match.scoreBlueFinal);
		} else {
			if (match.comp_level !== "qm") return [];
			qualificationNumber = Number(match.match_number);
			const alliances = typeof match.alliances === "object" && match.alliances !== null ? match.alliances as ApiObject : {};
			for (const color of ["red", "blue"] as const) {
				const alliance = typeof alliances[color] === "object" && alliances[color] !== null ? alliances[color] as ApiObject : {};
			const allianceTeams = Array.isArray(alliance.team_keys) ? alliance.team_keys.map((team) => String(team).replace(/^frc/, "")) : [];
			teams.push(...allianceTeams);
			if (color === "red") redTeams = allianceTeams;
			else blueTeams = allianceTeams;
			if (color === "red") redScore = nonnegativeScore(alliance.score);
			else blueScore = nonnegativeScore(alliance.score);
			}
			const rawTime = match.time ?? match.predicted_time;
			if (typeof rawTime === "number") scheduledTime = new Date(rawTime * 1000).toISOString();
			else if (typeof rawTime === "string") scheduledTime = rawTime;
		}
		if (!Number.isInteger(qualificationNumber) || qualificationNumber < 1) return [];
		return [{
			matchKey: `qual-${qualificationNumber}`,
			qualificationNumber,
			teams,
			redTeams,
			blueTeams,
			scheduledTime: scheduledTime || null,
			redScore,
			blueScore,
			completed: redScore !== null && blueScore !== null,
			prediction: { redScore: null, blueScore: null, redWinProbability: null },
		}];
	}).sort((first, second) => first.qualificationNumber - second.qualificationNumber);
}

function nonnegativeScore(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseCompatibilityWeights(value: string | null): CompatibilityWeights {
	if (!value) return DEFAULT_COMPATIBILITY_WEIGHTS;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		const values = Object.keys(DEFAULT_COMPATIBILITY_WEIGHTS).map((key) => parsed[key]);
		if (values.some((weight) => typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100)) {
			return DEFAULT_COMPATIBILITY_WEIGHTS;
		}
		return parsed as CompatibilityWeights;
	} catch {
		return DEFAULT_COMPATIBILITY_WEIGHTS;
	}
}

function robotCapabilityScore(value: string, weights: CompatibilityWeights): number | null {
	try {
		const capabilities = JSON.parse(value) as Record<string, unknown>;
		if (typeof capabilities.flower !== "boolean" || typeof capabilities.hive !== "boolean") return null;
		const flowerActions = Array.isArray(capabilities.flowerActions) ? capabilities.flowerActions : [];
		const features: [keyof CompatibilityWeights, boolean][] = [
			["flowerCapability", capabilities.flower],
			["flowerTakeFrom", capabilities.flower && flowerActions.includes("Take from")],
			["flowerInputInto", capabilities.flower && flowerActions.includes("Input into")],
			["hiveCapability", capabilities.hive],
			["hivePosition", capabilities.hive && typeof capabilities.hivePosition === "string"],
			["hiveShooterType", capabilities.hive && typeof capabilities.hiveShooterType === "string"],
		];
		const totalWeight = features.reduce((sum, [key]) => sum + weights[key], 0);
		if (totalWeight === 0) return 50;
		return features.reduce((sum, [key, active]) => sum + (active ? weights[key] : 0), 0) / totalWeight * 100;
	} catch {
		return null;
	}
}

function average(values: number[]) {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function buildMatchPredictions(
	matches: Omit<EventMatch, "notes">[],
	capabilitiesByTeam: Map<string, number>,
	league: League,
) {
	const scoresByTeam = new Map<string, number[]>();
	const scoreMargins: number[] = [];
	const allScores: number[] = [];
	for (const match of matches) {
		if (!match.completed || match.redScore === null || match.blueScore === null) continue;
		scoreMargins.push(match.redScore - match.blueScore);
		allScores.push(match.redScore, match.blueScore);
		for (const team of match.redTeams) scoresByTeam.set(team, [...(scoresByTeam.get(team) || []), match.redScore]);
		for (const team of match.blueTeams) scoresByTeam.set(team, [...(scoresByTeam.get(team) || []), match.blueScore]);
	}
	const eventAverage = average(allScores);
	const meanMargin = average(scoreMargins) || 0;
	const marginDeviation = scoreMargins.length > 1
		? Math.sqrt(average(scoreMargins.map((margin) => (margin - meanMargin) ** 2)) || 0)
		: 0;
	const scoreScale = Math.max(8, marginDeviation || (eventAverage || 60) * 0.18);
	const capabilityAverage = (teams: string[]) => {
		if (league !== "FTC") return 50;
		return average(teams.map((team) => capabilitiesByTeam.get(team)).filter((score): score is number => score !== undefined)) ?? 50;
	};
	const allianceAverage = (teams: string[]) =>
		average(teams.map((team) => average(scoresByTeam.get(team) || [])).filter((score): score is number => score !== null)) ?? eventAverage;

	return matches.map((match) => {
		const redScore = allianceAverage(match.redTeams);
		const blueScore = allianceAverage(match.blueTeams);
		let redWinProbability: number | null = null;
		if (redScore !== null && blueScore !== null) {
			const capabilityLogOdds = league === "FTC"
				? (capabilityAverage(match.redTeams) - capabilityAverage(match.blueTeams)) / 100
				: 0;
			const scoreLogOdds = (redScore - blueScore) / scoreScale;
			redWinProbability = 1 / (1 + Math.exp(-(scoreLogOdds + capabilityLogOdds)));
		}
		return { ...match, prediction: { redScore, blueScore, redWinProbability } };
	});
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
	let scheduleData: ApiObject[] | null = null;
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
		const scheduleResult = await fetchJson<ApiObject>(`${FTC_API_BASE}/${season}/schedule/${encodeURIComponent(eventCode)}/qual/hybrid`, {
			Accept: "application/json",
			Authorization: authorization,
		});
		scheduleData = records(scheduleResult.data, "schedule");
		event = records(eventResult.data, "events")[0] || null;
		teams = records(teamsResult.data, "teams").map((team) => ({
			number: stringField(team, ["teamNumber"]),
			name: stringField(team, ["nameShort", "nameLong", "name"]),
			manual: false,
		})).filter((team) => Boolean(team.number));
		warning = [eventResult.warning, teamsResult.warning, scheduleResult.warning].filter(Boolean).join(" ") || null;
		if (!event) return json({ error: warning || "Event not found in the FIRST API." }, warning ? 502 : 404);
	} else {
		if (!env.TBA_AUTH_KEY) return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
		const [eventResult, teamsResult, scheduleResult] = await Promise.all([
			fetchJson<ApiObject>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}`, {
				Accept: "application/json",
				"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
			}),
			fetchJson<ApiObject[]>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}/teams`, {
				Accept: "application/json",
				"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
			}),
			fetchJson<ApiObject[]>(`${TBA_API_BASE}/event/${encodeURIComponent(eventCode)}/matches`, {
				Accept: "application/json",
				"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
			}),
		]);
		event = eventResult.data;
		scheduleData = scheduleResult.data;
		teams = (teamsResult.data || []).map((team) => ({
			number: stringField(team, ["team_number", "key"]).replace(/^frc/, ""),
			name: stringField(team, ["nickname", "name"]),
			manual: false,
		})).filter((team) => Boolean(team.number));
		warning = [eventResult.warning, teamsResult.warning, scheduleResult.warning].filter(Boolean).join(" ") || null;
		if (!event) return json({ error: warning || "Event not found in The Blue Alliance." }, warning ? 502 : 404);
	}

	const matches = custom ? [] : qualificationMatches(scheduleData, league);
	const [notes, assets, manualTeams, matchNotes, compatibilityRow, robotRows] = await Promise.all([
		env.SCOUTING_DB.prepare("SELECT category, note, updated_by_account_name FROM event_notes WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).all<{ category: string; note: string; updated_by_account_name: string }>(),
		env.SCOUTING_DB.prepare("SELECT photos_url FROM event_assets WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).first<{ photos_url: string }>(),
		env.SCOUTING_DB.prepare("SELECT team_number, team_name FROM event_manual_teams WHERE league = ? AND season = ? AND event_code = ? ORDER BY team_number")
			.bind(league, season, eventCode).all<{ team_number: string; team_name: string }>(),
		env.SCOUTING_DB.prepare("SELECT match_key, phase, note, updated_by_account_name FROM event_match_scouting WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).all<{ match_key: string; phase: MatchPhase; note: string; updated_by_account_name: string }>(),
		env.SCOUTING_DB.prepare("SELECT weights FROM compatibility_settings WHERE id = 'global'")
			.first<{ weights: string }>(),
		env.SCOUTING_DB.prepare("SELECT id, team_number, name, autos, start_month, created_at, scoring_capabilities FROM robot_entries WHERE season = ? AND end_month IS NULL ORDER BY start_month DESC, created_at DESC")
			.bind(season).all<{ id: string; team_number: string; name: string; autos: string; start_month: string; created_at: string; scoring_capabilities: string }>(),
	]);
	let matchAutoPaths: { results: { match_key: string; path: string; updated_by_account_name: string }[] } = { results: [] };
	let autoPathMigrationPending = false;
	try {
		matchAutoPaths = await env.SCOUTING_DB.prepare("SELECT match_key, path, updated_by_account_name FROM event_match_auto_paths WHERE league = ? AND season = ? AND event_code = ?")
			.bind(league, season, eventCode).all<{ match_key: string; path: string; updated_by_account_name: string }>();
	} catch (error) {
		if (!(error instanceof Error) || !/no such table:\s*event_match_auto_paths/i.test(error.message)) throw error;
		autoPathMigrationPending = true;
		console.error(JSON.stringify({
			message: "Autonomous path storage is unavailable because its migration has not been applied",
			migration: "0017_event_match_auto_paths.sql",
		}));
	}
	let autoSelections: { results: { match_key: string; team_number: string; robot_id: string; auto_id: string; updated_by_account_name: string; autos: string | null }[] } = { results: [] };
	let autoSelectionMigrationPending = false;
	try {
		autoSelections = await env.SCOUTING_DB.prepare(`SELECT selection.match_key, selection.team_number, selection.robot_id, selection.auto_id,
			selection.updated_by_account_name, robot.autos
			FROM event_match_auto_selections selection
			LEFT JOIN robot_entries robot ON robot.id = selection.robot_id
			WHERE selection.league = ? AND selection.season = ? AND selection.event_code = ?`)
			.bind(league, season, eventCode)
			.all<{ match_key: string; team_number: string; robot_id: string; auto_id: string; updated_by_account_name: string; autos: string | null }>();
	} catch (error) {
		if (!(error instanceof Error) || !/no such table:\s*event_match_auto_selections/i.test(error.message)) throw error;
		autoSelectionMigrationPending = true;
		console.error(JSON.stringify({
			message: "Qualification auto selections are unavailable because their migration has not been applied",
			migration: "0018_event_match_auto_selections.sql",
		}));
	}
	const compatibilityWeights = parseCompatibilityWeights(compatibilityRow?.weights || null);
	const activeRobotsByTeam = new Map<string, { id: string; name: string; autos: EventAuto[] }>();
	const capabilityValues = new Map<string, number[]>();
	for (const robot of robotRows.results) {
		const teamNumber = robot.team_number.replace(/^frc:/, "");
		if (!matches.some((match) => match.teams.includes(teamNumber))) continue;
		if (!activeRobotsByTeam.has(teamNumber)) {
			activeRobotsByTeam.set(teamNumber, { id: robot.id, name: robot.name, autos: parseRobotAutos(robot.autos) });
		}
		const score = robotCapabilityScore(robot.scoring_capabilities, compatibilityWeights);
		if (score !== null) capabilityValues.set(teamNumber, [...(capabilityValues.get(teamNumber) || []), score]);
	}
	const capabilitiesByTeam = new Map([...capabilityValues].map(([number, scores]) => [number, average(scores) || 0]));
	const forecastMatches = buildMatchPredictions(matches, capabilitiesByTeam, league);
	const notesByMatch = new Map<string, EventMatch["notes"]>();
	const autoPathsByMatch = new Map<string, NonNullable<EventMatch["autoPath"]>>();
	const autoSelectionsByMatch = new Map<string, EventAutoSelection[]>();
	for (const item of matchNotes.results) {
		const notes = notesByMatch.get(item.match_key) || {};
		notes[item.phase] = { value: item.note, displayName: item.updated_by_account_name };
		notesByMatch.set(item.match_key, notes);
	}
	for (const item of matchAutoPaths.results) {
		const path = parseAutoPath(JSON.parse(item.path));
		if (!path) throw new Error(`Saved autonomous path for ${item.match_key} is invalid.`);
		autoPathsByMatch.set(item.match_key, { path, displayName: item.updated_by_account_name });
	}
	for (const item of autoSelections.results) {
		if (!item.autos) continue;
		const auto = parseRobotAutos(item.autos).find((candidate) => candidate.id === item.auto_id);
		if (!auto) continue;
		const selections = autoSelectionsByMatch.get(item.match_key) || [];
		selections.push({
			teamNumber: item.team_number,
			robotId: item.robot_id,
			autoId: item.auto_id,
			autoName: auto.name,
			path: auto.path,
			displayName: item.updated_by_account_name,
		});
		autoSelectionsByMatch.set(item.match_key, selections);
	}
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
		activeRobots: Object.fromEntries(activeRobotsByTeam),
		matches: forecastMatches.map((match) => ({
			...match,
			notes: notesByMatch.get(match.matchKey) || {},
			autoPath: autoPathsByMatch.get(match.matchKey) || null,
			autoSelections: autoSelectionsByMatch.get(match.matchKey) || [],
		})),
		notes: Object.fromEntries(notes.results.map((note) => [note.category, { value: note.note, displayName: note.updated_by_account_name }])),
		photosUrl: assets?.photos_url || "",
		warning: [
			warning,
			autoPathMigrationPending ? "Legacy unassigned qualification paths are unavailable until migration 0017 is applied." : null,
			autoSelectionMigrationPending ? "Team auto selection is temporarily unavailable. Apply database migration 0018 to enable it." : null,
		].filter(Boolean).join(" ") || null,
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
	let body: {
		action?: unknown;
		category?: unknown;
		note?: unknown;
		photosUrl?: unknown;
		teamNumber?: unknown;
		teamName?: unknown;
		matchKey?: unknown;
		notes?: unknown;
		autoMapping?: unknown;
	};
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid event edit payload." }, 400);
	}

	try {
		const actor = await getAuditActor(env, session.sub, getLocalContributorName(request), true);
		const displayName = actor.accountName;
		if (body.action === "match-scouting") {
			if (typeof body.matchKey !== "string" || !/^qual-\d{1,4}$/.test(body.matchKey)) return json({ error: "Choose a valid qualification." }, 400);
			let requestedAutoMapping: { teamNumber: string; type: "new" | "existing"; autoId?: string; path?: AutoPath } | null = null;
			let verifiedMatch: Omit<EventMatch, "notes"> | null = null;
			if (body.autoMapping !== undefined) {
				if (league !== "FTC" || (season !== "2025" && season !== "2026")) {
					return json({ error: "Autonomous path mapping is available for 2025–26 and 2026–27 FTC qualifications." }, 400);
				}
				if (typeof body.autoMapping !== "object" || body.autoMapping === null || Array.isArray(body.autoMapping)) {
					return json({ error: "Choose a team and an autonomous routine." }, 400);
				}
				const mapping = body.autoMapping as Record<string, unknown>;
				if (typeof mapping.teamNumber !== "string" || !/^\d{1,6}$/.test(mapping.teamNumber) ||
					(mapping.type !== "new" && mapping.type !== "existing")) {
					return json({ error: "Choose a valid team and autonomous routine." }, 400);
				}
				verifiedMatch = await getQualificationMatch(env, league, season, eventCode, body.matchKey);
				if (!verifiedMatch) return json({ error: "Qualification not found in the event schedule." }, 404);
				if (!verifiedMatch.teams.includes(mapping.teamNumber)) return json({ error: "Choose a team participating in this qualification." }, 400);
				if (mapping.type === "new") {
					const path = parseAutoPath(mapping.path);
					if (!path || path.points.length < 2 || path.points.length > 50) return json({ error: "Map a path with 2 to 50 points." }, 400);
					requestedAutoMapping = { teamNumber: mapping.teamNumber, type: "new", path };
				} else {
					if (typeof mapping.autoId !== "string" || !mapping.autoId || mapping.autoId.length > 100) {
						return json({ error: "Choose an existing autonomous routine." }, 400);
					}
					requestedAutoMapping = { teamNumber: mapping.teamNumber, type: "existing", autoId: mapping.autoId };
				}
			}
			const noteEdits: Partial<Record<MatchPhase, string>> = {};
			if (body.notes !== undefined) {
				if (typeof body.notes !== "object" || body.notes === null || Array.isArray(body.notes)) return json({ error: "Enter valid match notes." }, 400);
				for (const [phase, note] of Object.entries(body.notes)) {
					if (!MATCH_PHASES.includes(phase as MatchPhase) || typeof note !== "string" || note.length > 10000) {
						return json({ error: "Enter valid Auto, TeleOp, and Endgame notes of 10,000 characters or fewer." }, 400);
					}
					noteEdits[phase as MatchPhase] = note.trim();
				}
			}
			const statements: D1PreparedStatement[] = [];
			const savedNotes: Partial<Record<MatchPhase, { value: string; displayName: string }>> = {};
			for (const [phase, note] of Object.entries(noteEdits) as [MatchPhase, string][]) {
				const previous = await env.SCOUTING_DB.prepare(`SELECT note FROM event_match_scouting
					WHERE league = ? AND season = ? AND event_code = ? AND match_key = ? AND phase = ?`)
					.bind(league, season, eventCode, body.matchKey, phase).first<{ note: string }>();
				if ((previous?.note ?? "") === note) continue;
				statements.push(
					env.SCOUTING_DB.prepare(`INSERT INTO event_match_scouting (league, season, event_code, match_key, phase, note, updated_by, updated_by_account_name, updated_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
						ON CONFLICT(league, season, event_code, match_key, phase) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
						.bind(league, season, eventCode, body.matchKey, phase, note, session.sub, displayName),
					auditStatement(env.SCOUTING_DB, actor, "Updated qualification scouting notes", `${league} ${season} / ${eventCode} / ${body.matchKey} / ${phase}`, previous?.note ?? null, note),
				);
				savedNotes[phase] = { value: note, displayName };
			}

			if (requestedAutoMapping && verifiedMatch) {
				const dbTeamValue = dbTeamNumber(league, requestedAutoMapping.teamNumber);
				let robot = await env.SCOUTING_DB.prepare(`SELECT id, name, autos FROM robot_entries
					WHERE team_number = ? AND season = ? AND end_month IS NULL
					ORDER BY start_month DESC, created_at DESC LIMIT 1`)
					.bind(dbTeamValue, season).first<{ id: string; name: string; autos: string }>();
				const createRobot = !robot && requestedAutoMapping.type === "new";
				if (!robot && !createRobot) return json({ error: "This team has no active robot with saved autonomous routines." }, 400);
				if (createRobot) {
					robot = { id: crypto.randomUUID(), name: "Unnamed robot", autos: "[]" };
					statements.push(
						env.SCOUTING_DB.prepare(`INSERT INTO robot_entries
							(id, team_number, season, name, description, image_urls, start_month, end_month, autos, scoring_capabilities)
							VALUES (?, ?, ?, ?, '', '[]', '', NULL, '[]', '{}')`)
							.bind(robot.id, dbTeamValue, season, robot.name),
						auditStatement(env.SCOUTING_DB, actor, "Created unnamed active robot for qualification auto", `${league} ${season} / team ${requestedAutoMapping.teamNumber}`, null, robot.id),
					);
				}
				const robotAutos = parseRobotAutos(robot!.autos);
				let selectedAuto: EventAuto;
				if (requestedAutoMapping.type === "existing") {
					const existingAuto = robotAutos.find((auto) => auto.id === requestedAutoMapping!.autoId);
					if (!existingAuto) return json({ error: "That autonomous routine is not saved on the team's active robot." }, 400);
					selectedAuto = existingAuto;
				} else {
					selectedAuto = {
						id: crypto.randomUUID(),
						name: "",
						alliance: verifiedMatch.redTeams.includes(requestedAutoMapping.teamNumber) ? "red" : "blue",
						score: null,
						path: requestedAutoMapping.path!,
					};
					statements.push(
						env.SCOUTING_DB.prepare("UPDATE robot_entries SET autos = json_insert(autos, '$[#]', json(?)) WHERE id = ?")
							.bind(JSON.stringify(selectedAuto), robot!.id),
						auditStatement(env.SCOUTING_DB, actor, "Added autonomous routine to active robot", `${league} ${season} / team ${requestedAutoMapping.teamNumber} / ${robot!.name}`, null, JSON.stringify(selectedAuto)),
					);
				}
				const previous = await env.SCOUTING_DB.prepare(`SELECT auto_id FROM event_match_auto_selections
					WHERE league = ? AND season = ? AND event_code = ? AND match_key = ? AND team_number = ?`)
					.bind(league, season, eventCode, body.matchKey, requestedAutoMapping.teamNumber).first<{ auto_id: string }>();
				statements.push(
					env.SCOUTING_DB.prepare(`INSERT INTO event_match_auto_selections
						(league, season, event_code, match_key, team_number, robot_id, auto_id, updated_by, updated_by_account_name, updated_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
						ON CONFLICT(league, season, event_code, match_key, team_number)
						DO UPDATE SET robot_id = excluded.robot_id, auto_id = excluded.auto_id, updated_by = excluded.updated_by,
							updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
						.bind(league, season, eventCode, body.matchKey, requestedAutoMapping.teamNumber, robot!.id, selectedAuto.id, session.sub, displayName),
					auditStatement(env.SCOUTING_DB, actor, "Mapped qualification autonomous routine", `${league} ${season} / ${eventCode} / ${body.matchKey} / team ${requestedAutoMapping.teamNumber}`,
						previous?.auto_id ?? null, selectedAuto.id),
				);
			}
			if (statements.length) await env.SCOUTING_DB.batch(statements);
			return json({ matchKey: body.matchKey, notes: savedNotes, updated: statements.length > 0 });
		}
		if (body.action === "match-note") {
			if (typeof body.matchKey !== "string" || !/^qual-\d{1,4}$/.test(body.matchKey)) return json({ error: "Choose a valid qualification." }, 400);
			if (typeof body.category !== "string" || !MATCH_PHASES.includes(body.category as MatchPhase)) return json({ error: "Choose Auto, TeleOp, or Endgame." }, 400);
			if (typeof body.note !== "string" || body.note.length > 10000) return json({ error: "Match notes must be 10,000 characters or fewer." }, 400);
			const phase = body.category as MatchPhase;
			const previous = await env.SCOUTING_DB.prepare(`SELECT note FROM event_match_scouting
				WHERE league = ? AND season = ? AND event_code = ? AND match_key = ? AND phase = ?`)
				.bind(league, season, eventCode, body.matchKey, phase).first<{ note: string }>();
			const note = body.note.trim();
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare(`INSERT INTO event_match_scouting (league, season, event_code, match_key, phase, note, updated_by, updated_by_account_name, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(league, season, event_code, match_key, phase) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
					.bind(league, season, eventCode, body.matchKey, phase, note, session.sub, displayName),
				auditStatement(env.SCOUTING_DB, actor, "Updated qualification scouting notes", `${league} ${season} / ${eventCode} / ${body.matchKey} / ${phase}`, previous?.note ?? null, note),
			]);
			return json({ matchKey: body.matchKey, phase, note: { value: note, displayName } });
		}
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
		if (error instanceof Error && /no such table:\s*event_match_auto_selections/i.test(error.message)) {
			console.error(JSON.stringify({ message: "Could not save team auto selection because migration 0018 is not applied" }));
			return json({ error: "Team auto selection is not ready. Apply database migration 0018 and try again." }, 503);
		}
		console.error(JSON.stringify({ message: "Could not save event changes", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: `Could not save event changes: ${error instanceof Error ? error.message : "database error"}` }, 503);
	}
}

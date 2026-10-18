import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.events";
import { cloudflareContext } from "../cloudflare-context";

type League = "FTC" | "FRC";
type EventRecord = Record<string, unknown>;
type ApiResult<T> = { data: T | null; warning?: string };
type EventSummary = {
	code: string;
	name: string;
	startDate: string | null;
	endDate: string | null;
	region: string;
	city: string;
	state: string;
	country: string;
	custom?: boolean;
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
const US_REGION_NAMES: Record<string, string> = {
	AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
	CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
	HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
	KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
	MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
	MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
	NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
	OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
	SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
	VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
	DC: "District of Columbia", AS: "American Samoa", GU: "Guam", MP: "Northern Mariana Islands",
	PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};

function readableRegion(value: string) {
	return US_REGION_NAMES[value.toUpperCase()] || value;
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=300" },
	});
}

function getFtcAuthorization(env: EventEnv) {
	if (env.FTC_API_AUTH) return env.FTC_API_AUTH.startsWith("Basic ") ? env.FTC_API_AUTH : `Basic ${env.FTC_API_AUTH}`;
	if (env.FTC_API_USERNAME && env.FTC_API_KEY) return `Basic ${btoa(`${env.FTC_API_USERNAME}:${env.FTC_API_KEY}`)}`;
	return null;
}

async function authenticate(request: Request, env: EventEnv) {
	if (!env.CLERK_SECRET_KEY) return false;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return false;
	try {
		await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
		return true;
	} catch {
		return false;
	}
}

async function fetchJson<T>(url: string, headers: HeadersInit): Promise<ApiResult<T>> {
	try {
		const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
		if (!response.ok) return { data: null, warning: `Event data provider returned ${response.status}.` };
		return { data: await response.json() as T };
	} catch (error) {
		return { data: null, warning: `Event data request failed: ${error instanceof Error ? error.message : "unknown error"}` };
	}
}

function records(value: unknown, key: string): EventRecord[] {
	if (typeof value !== "object" || value === null || !(key in value)) return [];
	const list = (value as Record<string, unknown>)[key];
	return Array.isArray(list) ? list as EventRecord[] : [];
}

function stringField(record: EventRecord, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return "";
}

function summarizeEvent(event: EventRecord, league: League): EventSummary | null {
	const code = stringField(event, league === "FTC" ? ["code"] : ["key"]);
	if (!code) return null;
	const district = typeof event.district === "object" && event.district !== null
		? event.district as EventRecord
		: {};
	return {
		code,
		name: stringField(event, ["name", "eventName"]) || code,
		startDate: stringField(event, league === "FTC" ? ["dateStart", "start_date"] : ["start_date"]) || null,
		endDate: stringField(event, league === "FTC" ? ["dateEnd", "end_date"] : ["end_date"]) || null,
		region: readableRegion(league === "FTC"
			? stringField(event, ["regionCode", "region"])
			: stringField(district, ["display_name", "abbreviation"]) || stringField(event, ["state_prov", "country"]) || "Other"),
		city: stringField(event, ["city"]),
		state: stringField(event, ["stateProv", "state_prov"]),
		country: stringField(event, ["country"]),
	};
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as EventEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	if (!await authenticate(request, env)) return json({ error: "Authentication required." }, 401);

	const url = new URL(request.url);
	const league = url.searchParams.get("league")?.toUpperCase();
	const season = url.searchParams.get("season") || "";
	const region = url.searchParams.get("region")?.trim() || "";
	if (league !== "FTC" && league !== "FRC") return json({ error: "Choose FTC or FRC." }, 400);
	if (!/^\d{4}$/.test(season) || Number(season) < 1992 || Number(season) > 2100) return json({ error: "Choose a valid season." }, 400);

	let summaries: EventSummary[] = [];
	let warning: string | null = null;
	if (league === "FTC") {
		const authorization = getFtcAuthorization(env);
		if (!authorization) return json({ error: "FTC API credentials are not configured." }, 503);
		const result = await fetchJson<Record<string, unknown>>(`${FTC_API_BASE}/${season}/events`, {
			Accept: "application/json",
			Authorization: authorization,
		});
		warning = result.warning || null;
		summaries = records(result.data, "events").map((event) => summarizeEvent(event, league)).filter((event): event is EventSummary => Boolean(event));
	} else {
		if (!env.TBA_AUTH_KEY) return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
		const result = await fetchJson<EventRecord[]>(`${TBA_API_BASE}/events/${season}`, {
			Accept: "application/json",
			"X-TBA-Auth-Key": env.TBA_AUTH_KEY,
		});
		warning = result.warning || null;
		summaries = (result.data || []).map((event) => summarizeEvent(event, league)).filter((event): event is EventSummary => Boolean(event));
	}

	const leagueTeamPredicate = league === "FRC" ? "team_number LIKE 'frc:%'" : "team_number NOT LIKE 'frc:%'";
	const customEvents = await env.SCOUTING_DB?.prepare(
		`SELECT event_code, event_name, event_date FROM custom_events WHERE season = ? AND ${leagueTeamPredicate} GROUP BY event_code, event_name, event_date ORDER BY event_date, event_name`,
	).bind(season).all<{ event_code: string; event_name: string; event_date: string | null }>();
	for (const custom of customEvents?.results || []) {
		summaries.push({
			code: custom.event_code,
			name: custom.event_name,
			startDate: custom.event_date,
			endDate: custom.event_date,
			region: "Custom",
			city: "",
			state: "",
			country: "",
			custom: true,
		});
	}
	const regions = [...new Set(summaries.map((event) => event.region || "Other"))].sort((a, b) => a.localeCompare(b));
	const filtered = region ? summaries.filter((event) => (event.region || "Other") === region) : summaries;
	filtered.sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999") || a.name.localeCompare(b.name));
	return json({ events: filtered, regions, warning });
}

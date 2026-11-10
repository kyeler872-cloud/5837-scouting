import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.search-team";
import { cloudflareContext } from "../cloudflare-context";

type League = "FTC" | "FRC";
type SearchEnv = Env & {
	CLERK_SECRET_KEY?: string;
	FTC_API_AUTH?: string;
	FTC_API_USERNAME?: string;
	FTC_API_KEY?: string;
	TBA_AUTH_KEY?: string;
};

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, max-age=60" } });
}

function getFtcAuthorization(env: SearchEnv) {
	if (env.FTC_API_AUTH) return env.FTC_API_AUTH.startsWith("Basic ") ? env.FTC_API_AUTH : `Basic ${env.FTC_API_AUTH}`;
	if (env.FTC_API_USERNAME && env.FTC_API_KEY) return `Basic ${btoa(`${env.FTC_API_USERNAME}:${env.FTC_API_KEY}`)}`;
	return null;
}

function stringField(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return "";
}

async function authenticate(request: Request, env: SearchEnv) {
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

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as SearchEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	if (!await authenticate(request, env)) return json({ error: "Authentication required." }, 401);

	const url = new URL(request.url);
	const league = url.searchParams.get("league")?.toUpperCase();
	const season = url.searchParams.get("season") || "2026";
	const teamNumber = params.teamNumber?.trim() || "";
	if (league !== "FTC" && league !== "FRC") return json({ error: "Choose FTC or FRC." }, 400);
	if (!/^\d{1,6}$/.test(teamNumber)) return json({ error: "Enter a valid team number." }, 400);
	if (!/^\d{4}$/.test(season) || Number(season) < 1992 || Number(season) > 2100) return json({ error: "Choose a valid season." }, 400);

	try {
		let team: Record<string, unknown> | null = null;
		if (league === "FTC") {
			const authorization = getFtcAuthorization(env);
			if (!authorization) return json({ error: "FTC API credentials are not configured." }, 503);
			const findTeam = async (year: string) => {
				const response = await fetch(`https://ftc-api.firstinspires.org/v2.0/${year}/teams?teamNumber=${encodeURIComponent(teamNumber)}`, {
					headers: { Accept: "application/json", Authorization: authorization },
					signal: AbortSignal.timeout(8000),
				});
				if (response.status === 404) return null;
				if (!response.ok) throw new Error(`FTC API returned ${response.status}.`);
				const data = await response.json() as { teams?: Record<string, unknown>[] };
				return data.teams?.find((item) => stringField(item, ["teamNumber"]) === teamNumber) || null;
			};
			team = await findTeam(season);
			if (!team && season === "2026" && teamNumber.length >= 4) team = await findTeam("2025");
		} else {
			if (!env.TBA_AUTH_KEY) return json({ error: "The Blue Alliance API key is not configured on the server." }, 503);
			const response = await fetch(`https://www.thebluealliance.com/api/v3/team/frc${encodeURIComponent(teamNumber)}`, {
				headers: { Accept: "application/json", "X-TBA-Auth-Key": env.TBA_AUTH_KEY },
				signal: AbortSignal.timeout(8000),
			});
			if (response.status === 404) return json({ team: null });
			if (!response.ok) return json({ error: `The Blue Alliance API returned ${response.status}.` }, 502);
			team = await response.json() as Record<string, unknown>;
		}

		if (!team) return json({ team: null });
		return json({
			team: {
				number: teamNumber,
				name: stringField(team, league === "FTC" ? ["nameShort", "name", "nameLong"] : ["nickname", "name"]),
				city: stringField(team, ["city"]),
				state: stringField(team, ["stateProv", "state_prov"]),
				country: stringField(team, ["country"]),
			},
		});
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not search teams", league, error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Team search is temporarily unavailable." }, 502);
	}
}

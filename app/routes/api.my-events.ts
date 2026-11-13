import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.my-events";
import { cloudflareContext } from "../cloudflare-context";

type UserEventsEnv = Env & { CLERK_SECRET_KEY?: string; SCOUTING_DB?: D1Database };
type UserScoutingEvent = { league: "FTC" | "FRC"; season: string; event_code: string };

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

async function authenticate(request: Request, env: UserEventsEnv) {
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!env.CLERK_SECRET_KEY || !token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

function validEvent(league: unknown, season: unknown, eventCode: unknown): league is "FTC" | "FRC" {
	return (league === "FTC" || league === "FRC") &&
		typeof season === "string" && /^\d{4}$/.test(season) && Number(season) >= 1992 && Number(season) <= 2100 &&
		typeof eventCode === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(eventCode);
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as UserEventsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	try {
		const events = await env.SCOUTING_DB.prepare(`SELECT league, season, event_code
			FROM user_scouting_events WHERE user_id = ? ORDER BY season, league, event_code`)
			.bind(session.sub).all<UserScoutingEvent>();
		return json({ events: events.results.map(({ league, season, event_code }) => ({ league, season, eventCode: event_code })) });
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not load personal scouting events", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not load your scouting events. Confirm database migration 0028 has been applied." }, 503);
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as UserEventsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	let body: { league?: unknown; season?: unknown; eventCode?: unknown; going?: unknown };
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid scouting event request." }, 400);
	}
	if (!validEvent(body.league, body.season, body.eventCode) || typeof body.going !== "boolean") {
		return json({ error: "Choose a valid event and scouting status." }, 400);
	}

	try {
		if (body.going) {
			await env.SCOUTING_DB.prepare(`INSERT INTO user_scouting_events (user_id, league, season, event_code)
				VALUES (?, ?, ?, ?) ON CONFLICT(user_id, league, season, event_code) DO NOTHING`)
				.bind(session.sub, body.league, body.season, body.eventCode).run();
		} else {
			await env.SCOUTING_DB.prepare(`DELETE FROM user_scouting_events
				WHERE user_id = ? AND league = ? AND season = ? AND event_code = ?`)
				.bind(session.sub, body.league, body.season, body.eventCode).run();
		}
		return json({ going: body.going });
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not save personal scouting event", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not save your scouting event. Confirm database migration 0028 has been applied." }, 503);
	}
}

import type { Route } from "./+types/api.access-requests";
import { cloudflareContext } from "../cloudflare-context";

type RequestEnv = Env & { SCOUTING_DB?: D1Database };

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function parseTeams(ftcValue: unknown, frcValue: unknown) {
	if (
		typeof ftcValue !== "string" || ftcValue.length > 200 ||
		typeof frcValue !== "string" || frcValue.length > 200
	) return null;
	const parseLeague = (value: string, league: "FTC" | "FRC") => {
		const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
		if (parts.some((part) => !/^\d{1,6}$/.test(part))) return null;
		return parts.map((teamNumber) => ({ league, teamNumber }));
	};
	const ftcTeams = parseLeague(ftcValue, "FTC");
	const frcTeams = parseLeague(frcValue, "FRC");
	if (!ftcTeams || !frcTeams || ftcTeams.length + frcTeams.length === 0 || ftcTeams.length + frcTeams.length > 30) return null;
	const teams = [...ftcTeams, ...frcTeams];
	const unique = new Map(teams.map((team) => [`${team.league}:${team.teamNumber}`, team]));
	return [...unique.values()];
}

export async function action({ request, context }: Route.ActionArgs) {
	if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
	const env = context.get(cloudflareContext).env as RequestEnv;
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);
	let body: {
		name?: unknown;
		organizationName?: unknown;
		email?: unknown;
		role?: unknown;
		message?: unknown;
		ftcTeamNumbers?: unknown;
		frcTeamNumbers?: unknown;
		website?: unknown;
	};
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid access request." }, 400);
	}
	if (typeof body.website === "string" && body.website.trim()) return json({ error: "Could not submit access request." }, 400);
	if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
		return json({ error: "Enter your name (up to 120 characters)." }, 400);
	}
	if (typeof body.organizationName !== "string" || !body.organizationName.trim() || body.organizationName.trim().length > 100) {
		return json({ error: "Enter the team or organization name (up to 100 characters)." }, 400);
	}
	if (typeof body.email !== "string" || body.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
		return json({ error: "Enter a valid email address." }, 400);
	}
	if (body.role !== "student" && body.role !== "mentor") return json({ error: "Choose student or mentor." }, 400);
	if (typeof body.message !== "string" || body.message.trim().length > 4000) return json({ error: "Keep your message to 4,000 characters or fewer." }, 400);
	const teams = parseTeams(body.ftcTeamNumbers, body.frcTeamNumbers);
	if (!teams) return json({ error: "Enter up to 30 numeric FTC or FRC team numbers, with at least one number overall." }, 400);

	try {
		const email = body.email.trim().toLowerCase();
		const pending = await env.SCOUTING_DB.prepare(`SELECT id FROM organization_access_requests
			WHERE lower(email) = ? AND status = 'pending' LIMIT 1`)
			.bind(email).first<{ id: string }>();
		if (pending) return json({ error: "There is already a pending request for this email." }, 409);
		await env.SCOUTING_DB.prepare(`INSERT INTO organization_access_requests
			(id, name, organization_name, email, role, message, team_numbers)
			VALUES (?, ?, ?, ?, ?, ?, ?)`)
			.bind(crypto.randomUUID(), body.name.trim(), body.organizationName.trim(), email, body.role, body.message.trim(), JSON.stringify(teams)).run();
		return json({ submitted: true });
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not submit organization access request", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not submit your request. Please try again later." }, 503);
	}
}

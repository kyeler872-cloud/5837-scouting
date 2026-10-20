import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.logs";
import { auditStatement, getAuditActor } from "../audit.server";
import { cloudflareContext } from "../cloudflare-context";

type LogsEnv = Env & { SCOUTING_DB?: D1Database };
type WhitelistEntry = { id: string; email: string | null; account_name: string | null; added_at: string };

const OWNER_NAME = "Kyeler Werkmeister";
const PAGE_SIZE = 100;

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

async function authenticate(request: Request, env: LogsEnv) {
	if (!env.CLERK_SECRET_KEY) return null;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

async function canViewLogs(db: D1Database, actor: Awaited<ReturnType<typeof getAuditActor>>) {
	if (actor.accountName.trim().toLowerCase() === OWNER_NAME.toLowerCase()) return true;
	const allowed = await db.prepare(`SELECT 1 AS allowed FROM logs_access_whitelist
		WHERE (email IS NOT NULL AND lower(email) = ?)
		OR (account_name IS NOT NULL AND lower(account_name) = ?) LIMIT 1`)
		.bind(actor.email || "", actor.accountName.trim().toLowerCase())
		.first<{ allowed: number }>();
	return Boolean(allowed);
}

async function whitelist(db: D1Database) {
	const result = await db.prepare(`SELECT id, email, account_name, added_at
		FROM logs_access_whitelist ORDER BY lower(COALESCE(account_name, email)), id`)
		.all<WhitelistEntry>();
	return result.results;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as LogsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	try {
		const actor = await getAuditActor(env, session.sub);
		if (!await canViewLogs(env.SCOUTING_DB, actor)) return json({ error: "Your account can't access this debug page." }, 403);

		await env.SCOUTING_DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-7 days')").run();
		const url = new URL(request.url);
		const beforeTime = url.searchParams.get("beforeTime");
		const beforeId = url.searchParams.get("beforeId");
		const rows = beforeTime && beforeId
			? await env.SCOUTING_DB.prepare(`SELECT id, created_at, account_name, email, action, target, previous_text, new_text
				FROM audit_logs
				WHERE created_at >= datetime('now', '-7 days')
					AND (created_at < ? OR (created_at = ? AND id < ?))
				ORDER BY created_at DESC, id DESC LIMIT ?`)
				.bind(beforeTime, beforeTime, beforeId, PAGE_SIZE + 1).all()
			: await env.SCOUTING_DB.prepare(`SELECT id, created_at, account_name, email, action, target, previous_text, new_text
				FROM audit_logs WHERE created_at >= datetime('now', '-7 days')
				ORDER BY created_at DESC, id DESC LIMIT ?`)
				.bind(PAGE_SIZE + 1).all();
		const hasMore = rows.results.length > PAGE_SIZE;
		const logs = rows.results.slice(0, PAGE_SIZE);
		const isOwner = actor.accountName.trim().toLowerCase() === OWNER_NAME.toLowerCase();
		return json({
			logs,
			hasMore,
			canManageWhitelist: isOwner,
			whitelist: isOwner ? await whitelist(env.SCOUTING_DB) : [],
		});
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not load audit logs", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not load debug logs. Confirm the audit database migration has been applied." }, 503);
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as LogsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	try {
		const actor = await getAuditActor(env, session.sub);
		if (actor.accountName.trim().toLowerCase() !== OWNER_NAME.toLowerCase()) {
			return json({ error: "Only Kyeler Werkmeister can manage the debug-page whitelist." }, 403);
		}
		let body: { action?: unknown; email?: unknown; accountName?: unknown; id?: unknown };
		try {
			body = await request.json() as typeof body;
		} catch {
			return json({ error: "Invalid whitelist request." }, 400);
		}

		if (body.action === "add") {
			const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
			const accountName = typeof body.accountName === "string" && body.accountName.trim() ? body.accountName.trim() : null;
			if (!email && !accountName) return json({ error: "Enter an email address or account name." }, 400);
			if ((email && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || (accountName && accountName.length > 100)) {
				return json({ error: "Enter a valid email address and account name." }, 400);
			}
			const id = crypto.randomUUID();
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare(`INSERT INTO logs_access_whitelist (id, email, account_name, added_by_user_id)
					VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
					.bind(id, email, accountName, session.sub),
				auditStatement(env.SCOUTING_DB, actor, "Added debug-page whitelist entry", [accountName, email].filter(Boolean).join(" / "),
					null, JSON.stringify({ accountName, email }, null, 2)),
			]);
			return json({ whitelist: await whitelist(env.SCOUTING_DB) });
		}

		if (body.action === "remove") {
			if (typeof body.id !== "string" || !/^[\da-f-]{36}$/i.test(body.id)) return json({ error: "Choose a valid whitelist entry." }, 400);
			const entry = await env.SCOUTING_DB.prepare("SELECT email, account_name FROM logs_access_whitelist WHERE id = ?")
				.bind(body.id).first<{ email: string | null; account_name: string | null }>();
			if (!entry) return json({ error: "Whitelist entry not found." }, 404);
			await env.SCOUTING_DB.batch([
				env.SCOUTING_DB.prepare("DELETE FROM logs_access_whitelist WHERE id = ?").bind(body.id),
				auditStatement(env.SCOUTING_DB, actor, "Removed debug-page whitelist entry", [entry.account_name, entry.email].filter(Boolean).join(" / "),
					JSON.stringify({ accountName: entry.account_name, email: entry.email }, null, 2), null),
			]);
			return json({ whitelist: await whitelist(env.SCOUTING_DB) });
		}

		return json({ error: "Choose a valid whitelist action." }, 400);
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not update debug-page whitelist", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not update the whitelist. Confirm the audit database migration has been applied." }, 503);
	}
}

import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.settings";
import { cloudflareContext } from "../cloudflare-context";
import { getAuditActor } from "../audit.server";

type SettingsEnv = Env & { SCOUTING_DB?: D1Database };
type CompatibilityWeights = {
	flowerCapability: number;
	flowerTakeFrom: number;
	flowerInputInto: number;
	hiveCapability: number;
	hivePosition: number;
	hiveShooterType: number;
};

const defaultWeights: CompatibilityWeights = {
	flowerCapability: 50,
	flowerTakeFrom: 50,
	flowerInputInto: 50,
	hiveCapability: 50,
	hivePosition: 50,
	hiveShooterType: 50,
};
const weightFields = Object.keys(defaultWeights) as (keyof CompatibilityWeights)[];

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

async function authenticate(request: Request, env: SettingsEnv) {
	if (!env.CLERK_SECRET_KEY) return null;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

function parseWeights(value: unknown): CompatibilityWeights | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (!weightFields.every((field) =>
		typeof record[field] === "number" && Number.isFinite(record[field]) && record[field] >= 0 && record[field] <= 100
	)) return null;
	return Object.fromEntries(weightFields.map((field) => [field, record[field]])) as CompatibilityWeights;
}

async function readSettings(db: D1Database) {
	const row = await db.prepare("SELECT weights, updated_by_account_name, updated_at FROM compatibility_settings WHERE id = 'global'")
		.first<{ weights: string; updated_by_account_name: string; updated_at: string }>();
	if (!row) return { weights: defaultWeights, updatedBy: null as string | null, updatedAt: null as string | null };
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.weights);
	} catch {
		throw new Error("Saved compatibility settings are invalid JSON.");
	}
	const weights = parseWeights(parsed);
	if (!weights) throw new Error("Saved compatibility settings contain invalid weight values.");
	return { weights, updatedBy: row.updated_by_account_name, updatedAt: row.updated_at };
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as SettingsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	if (!await authenticate(request, env)) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);
	try {
		return json(await readSettings(env.SCOUTING_DB));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not load compatibility settings", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not load compatibility settings. Confirm the latest database migration has been applied." }, 503);
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as SettingsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	let body: { weights?: unknown };
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid compatibility settings payload." }, 400);
	}
	const weights = parseWeights(body.weights);
	if (!weights) return json({ error: "Each compatibility influence must be a number from 0 to 100." }, 400);

	try {
		const actor = await getAuditActor(env, session.sub);
		await env.SCOUTING_DB.prepare(`INSERT INTO compatibility_settings (id, weights, updated_by_account_name, updated_at)
			VALUES ('global', ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(id) DO UPDATE SET weights = excluded.weights, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
			.bind(JSON.stringify(weights), actor.accountName)
			.run();
		return json(await readSettings(env.SCOUTING_DB));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not save compatibility settings", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not save compatibility settings. Confirm the latest database migration has been applied." }, 503);
	}
}

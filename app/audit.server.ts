import { createClerkClient } from "@clerk/backend";

export type AuditActor = {
	userId: string;
	accountName: string;
	email: string | null;
};

export const CONTRIBUTOR_EMAIL = "frcteam5837@gmail.com";

export type ContributorSession = { name: string; expiresAt: string };

export async function readContributorSession(db: D1Database, userId: string): Promise<ContributorSession | null> {
	return db.prepare(`SELECT contributor_name AS name, contributor_name_expires_at AS expiresAt
		FROM user_settings WHERE user_id = ? AND contributor_name IS NOT NULL
		AND contributor_name_expires_at > CURRENT_TIMESTAMP`)
		.bind(userId)
		.first<ContributorSession>();
}

export async function getContributorSetup(env: Env, userId: string) {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
	if (email !== CONTRIBUTOR_EMAIL) return { required: false, name: null, expiresAt: null };
	if (!env.SCOUTING_DB) throw new Error("Shared scouting storage is not configured.");
	const session = await readContributorSession(env.SCOUTING_DB, userId);
	return { required: true, name: session?.name || null, expiresAt: session?.expiresAt || null };
}

export async function resolveAccountName(env: Env, userId: string, email: string | null, defaultName: string) {
	if (email !== CONTRIBUTOR_EMAIL) return defaultName;
	if (!env.SCOUTING_DB) throw new Error("Shared scouting storage is not configured.");
	const session = await readContributorSession(env.SCOUTING_DB, userId);
	if (!session) throw new Error("Choose your credited name before contributing.");
	return session.name;
}

export async function getAuditActor(env: Env, userId: string): Promise<AuditActor> {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
	const defaultName = user.fullName?.trim() || user.username?.trim() || "Unknown account";
	return {
		userId,
		accountName: await resolveAccountName(env, userId, email, defaultName),
		email,
	};
}

export function auditStatement(
	db: D1Database,
	actor: AuditActor,
	action: string,
	target: string,
	previousText: string | null = null,
	newText: string | null = null,
) {
	return db.prepare(`INSERT INTO audit_logs (id, user_id, account_name, email, action, target, previous_text, new_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(
			crypto.randomUUID(),
			actor.userId,
			actor.accountName,
			actor.email,
			action.slice(0, 120),
			target.slice(0, 1000),
			previousText,
			newText,
		);
}

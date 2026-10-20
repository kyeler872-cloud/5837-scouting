import { createClerkClient } from "@clerk/backend";

export type AuditActor = {
	userId: string;
	accountName: string;
	email: string | null;
};

export async function getAuditActor(env: Env, userId: string): Promise<AuditActor> {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	return {
		userId,
		accountName: user.fullName?.trim() || user.username?.trim() || "Unknown account",
		email: user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null,
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

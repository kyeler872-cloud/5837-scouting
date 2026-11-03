import { createClerkClient } from "@clerk/backend";

export type AuditActor = {
	userId: string;
	accountName: string;
	email: string | null;
};

export const CONTRIBUTOR_EMAIL = "frcteam5837@gmail.com";
export const NOTE_ADMIN_EMAIL = "kyeler872@gmail.com";

export function validateContributorName(value: string | null | undefined) {
	const name = value?.trim() || "";
	if (!name || name.length > 12 || /[\r\n\0]/.test(name)) {
		throw new Error("Choose a valid local credited name before contributing.");
	}
	return name;
}

export function getLocalContributorName(request: Request) {
	const cookie = request.headers.get("Cookie");
	const value = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("scouting-contributor-name="))
		?.slice("scouting-contributor-name=".length);
	if (value === undefined) {
		const headerName = request.headers.get("X-Contributor-Name");
		return headerName === null ? null : validateContributorName(headerName);
	}
	try {
		return validateContributorName(decodeURIComponent(value));
	} catch {
		throw new Error("The local credited name cookie is invalid. Update the iPad name and try again.");
	}
}

export async function getContributorSetup(env: Env, userId: string) {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
	return { required: email === CONTRIBUTOR_EMAIL, name: null, expiresAt: null };
}

export function resolveAccountName(
	email: string | null,
	defaultName: string,
	contributorName?: string | null,
	requireContributorName = false,
) {
	if (email !== CONTRIBUTOR_EMAIL) return defaultName;
	return requireContributorName ? validateContributorName(contributorName) : defaultName;
}

export async function getAuditActor(
	env: Env,
	userId: string,
	contributorName?: string | null,
	requireContributorName = false,
): Promise<AuditActor> {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const user = await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId);
	const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
	const defaultName = user.fullName?.trim() || user.username?.trim() || "Unknown account";
	return {
		userId,
		accountName: resolveAccountName(email, defaultName, contributorName, requireContributorName),
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

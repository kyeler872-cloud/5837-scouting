import { createClerkClient } from "@clerk/backend";

export type AuditActor = {
	userId: string;
	accountName: string;
	email: string | null;
};

export const CONTRIBUTOR_EMAIL = "frcteam5837@gmail.com";
export const NOTE_ADMIN_EMAIL = "kyelerw@icloud.com";
const CONTRIBUTOR_NAME_COOKIE = "scouting-contributor-name";
const CONTRIBUTOR_EXPIRY_COOKIE = "scouting-contributor-expires-at";
type ContributorEnv = Env & { SCOUTING_DB?: D1Database };

export function validateContributorName(value: string | null | undefined) {
	const name = value?.trim() || "";
	if (!name || name.length > 80 || /[\r\n\0]/.test(name)) {
		throw new Error("Choose a valid local credited name before contributing.");
	}
	return name;
}

export function getLocalContributorSession(request: Request) {
	const cookies = new Map((request.headers.get("Cookie") || "").split(";").map((part) => {
		const separator = part.indexOf("=");
		return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
	}));
	const value = cookies.get(CONTRIBUTOR_NAME_COOKIE);
	const expiresAt = Number(cookies.get(CONTRIBUTOR_EXPIRY_COOKIE));
	if (value === undefined || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
		return { name: null, expiresAt: null };
	}
	try {
		return { name: validateContributorName(decodeURIComponent(value)), expiresAt: new Date(expiresAt).toISOString() };
	} catch {
		return { name: null, expiresAt: null };
	}
}

export function getLocalContributorName(request: Request) {
	return getLocalContributorSession(request).name;
}

export async function getContributorSetup(env: ContributorEnv, userId: string) {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	const [user, membership] = await Promise.all([
		createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(userId),
		env.SCOUTING_DB
			? env.SCOUTING_DB.prepare("SELECT role FROM organization_memberships WHERE user_id = ?")
				.bind(userId).first<{ role: string }>()
			: Promise.resolve(null),
	]);
	const email = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
	const kiosk = membership?.role === "kiosk";
	return { required: kiosk || email === CONTRIBUTOR_EMAIL, kiosk, name: null, expiresAt: null };
}

export function resolveAccountName(
	email: string | null,
	defaultName: string,
	contributorName?: string | null,
	requireContributorName = false,
	forceContributorName = false,
) {
	if (email !== CONTRIBUTOR_EMAIL && !forceContributorName) return defaultName;
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
	const membership = env.SCOUTING_DB
		? await env.SCOUTING_DB.prepare("SELECT role FROM organization_memberships WHERE user_id = ?")
			.bind(userId).first<{ role: string }>()
		: null;
	const defaultName = user.fullName?.trim() || user.username?.trim() || "Unknown account";
	const kiosk = membership?.role === "kiosk";
	return {
		userId,
		accountName: resolveAccountName(email, defaultName, contributorName, requireContributorName, kiosk),
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

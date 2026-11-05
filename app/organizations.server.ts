import { createClerkClient, verifyToken } from "@clerk/backend";

export const APP_ADMIN_EMAIL = "kyelerw@icloud.com";
export const WATERLOO_ORGANIZATION_ID = "waterloo-robotics";
export const WATERLOO_CLERK_ORGANIZATION_ID = "org_3Ld2tNWg6Q5p4Ldnk85sZ1SyZgr";

export type OrganizationRole = "student" | "mentor" | "kiosk";
export type OrganizationMembership = {
	organization_id: string;
	organization_name: string;
	clerk_organization_id: string | null;
	role: OrganizationRole;
};

type OrganizationEnv = Env & { SCOUTING_DB?: D1Database; CLERK_SECRET_KEY?: string };

export function getClerkClient(env: OrganizationEnv) {
	if (!env.CLERK_SECRET_KEY) throw new Error("Server authentication is not configured.");
	return createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
}

function clerkErrorMessage(error: unknown) {
	if (!(error instanceof Error)) return "Clerk returned an unknown error.";
	if (typeof error !== "object" || error === null || !("status" in error)) return error.message;
	const status = typeof error.status === "number" ? ` (HTTP ${error.status})` : "";
	if (!("errors" in error) || !Array.isArray(error.errors)) return `${error.message}${status}`;
	const firstError = error.errors.find((item): item is { longMessage?: string; message?: string; code?: string } =>
		typeof item === "object" && item !== null
	);
	const detail = firstError?.longMessage || firstError?.message || firstError?.code;
	return `${detail || error.message}${status}`;
}

export async function authenticateOrganizationRequest(request: Request, env: OrganizationEnv) {
	if (!env.CLERK_SECRET_KEY) return null;
	const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	if (!token) return null;
	try {
		return await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
	} catch {
		return null;
	}
}

export async function getOrganizationMembership(db: D1Database, userId: string) {
	return db.prepare(`SELECT m.organization_id, o.name AS organization_name, o.clerk_organization_id, m.role
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.user_id = ?`)
		.bind(userId)
		.first<OrganizationMembership>();
}

export async function ensureAdminWaterlooMembership(db: D1Database, userId: string) {
	await db.prepare(`INSERT INTO organization_memberships (user_id, organization_id, role)
		SELECT ?, id, 'mentor' FROM organizations WHERE id = ?
		ON CONFLICT(user_id) DO NOTHING`)
		.bind(userId, WATERLOO_ORGANIZATION_ID).run();
	return getOrganizationMembership(db, userId);
}

export async function getPrimaryEmail(env: OrganizationEnv, userId: string) {
	const user = await getClerkClient(env).users.getUser(userId);
	return user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || null;
}

export async function isAppAdmin(env: OrganizationEnv, userId: string) {
	const user = await getClerkClient(env).users.getUser(userId);
	return user.emailAddresses.some((address) =>
		address.emailAddress.trim().toLowerCase() === APP_ADMIN_EMAIL &&
		address.verification?.status === "verified"
	);
}

export async function getOrCreateJoinCode(db: D1Database, organizationId: string) {
	const current = await db.prepare("SELECT code FROM organization_join_codes WHERE organization_id = ?")
		.bind(organizationId).first<{ code: string }>();
	if (current) return current.code;

	const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
	const random = crypto.getRandomValues(new Uint8Array(14));
	const code = Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
	await db.prepare("INSERT INTO organization_join_codes (organization_id, code) VALUES (?, ?)")
		.bind(organizationId, code).run();
	return code;
}

export function clerkRoleFor(role: OrganizationRole) {
	return role === "mentor" ? "org:admin" : "org:member";
}

export async function createClerkMembership(
	env: OrganizationEnv,
	clerkOrganizationId: string,
	userId: string,
	role: OrganizationRole,
) {
	return getClerkClient(env).organizations.createOrganizationMembership({
		organizationId: clerkOrganizationId,
		userId,
		role: clerkRoleFor(role),
	});
}

export async function addOrganizationMember(
	db: D1Database,
	env: OrganizationEnv,
	organization: { id: string; clerk_organization_id: string },
	userId: string,
	role: OrganizationRole,
) {
	const existing = await getOrganizationMembership(db, userId);
	if (existing && existing.organization_id !== organization.id) {
		throw new Error("This account already belongs to another organization. Ask an administrator to move it.");
	}

	const currentClerkMemberships = await getClerkClient(env).organizations.getOrganizationMembershipList({
		organizationId: organization.clerk_organization_id,
		userId: [userId],
		limit: 1,
	});
	if (!currentClerkMemberships.data.length) {
		await createClerkMembership(env, organization.clerk_organization_id, userId, role);
	} else if (currentClerkMemberships.data[0].role !== clerkRoleFor(role)) {
		await getClerkClient(env).organizations.updateOrganizationMembership({
			organizationId: organization.clerk_organization_id,
			userId,
			role: clerkRoleFor(role),
		});
	}

	await db.prepare(`INSERT INTO organization_memberships (user_id, organization_id, role)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET organization_id = excluded.organization_id, role = excluded.role`)
		.bind(userId, organization.id, role).run();
}

export async function ensureWaterlooOrganization(db: D1Database, env: OrganizationEnv, adminUserId: string) {
	const record = await db.prepare("SELECT id, name, clerk_organization_id FROM organizations WHERE id = ?")
		.bind(WATERLOO_ORGANIZATION_ID)
		.first<{ id: string; name: string; clerk_organization_id: string | null }>();
	if (!record) throw new Error("Waterloo Robotics is missing from the organization database.");

	const client = getClerkClient(env);
	let clerkOrganizationId = record.clerk_organization_id;
	if (!clerkOrganizationId) {
		let clerkOrganization;
		try {
			clerkOrganization = await client.organizations.getOrganization({
				organizationId: WATERLOO_CLERK_ORGANIZATION_ID,
			});
		} catch (error) {
			throw new Error(`Could not load the existing Waterloo Robotics organization in Clerk: ${clerkErrorMessage(error)}`);
		}
		if (clerkOrganization.name.trim().toLowerCase() !== record.name.trim().toLowerCase()) {
			throw new Error("The configured Clerk organization ID does not match Waterloo Robotics.");
		}
		clerkOrganizationId = clerkOrganization.id;
		await db.prepare("UPDATE organizations SET clerk_organization_id = ?, created_by_user_id = COALESCE(created_by_user_id, ?) WHERE id = ?")
			.bind(clerkOrganizationId, adminUserId, record.id).run();
	}

	const clerkOrgId = clerkOrganizationId;
	const [users, existingMemberships] = await Promise.all([
		(async () => {
			const allUsers = [];
			for (let offset = 0; ; offset += 500) {
				const page = await client.users.getUserList({ limit: 500, offset });
				allUsers.push(...page.data);
				if (page.data.length < 500) break;
			}
			return allUsers;
		})(),
		(async () => {
			const allMemberships = [];
			for (let offset = 0; ; offset += 500) {
				const page = await client.organizations.getOrganizationMembershipList({
					organizationId: clerkOrgId,
					limit: 500,
					offset,
				});
				allMemberships.push(...page.data);
				if (page.data.length < 500) break;
			}
			return allMemberships;
		})(),
	]);
	const existingMembershipByUserId = new Map(existingMemberships
		.map((membership) => [membership.publicUserData?.userId, membership] as const)
		.filter((entry): entry is readonly [string, typeof existingMemberships[number]] => Boolean(entry[0])));
	let enrolledCount = 0;
	let enrollmentFailureCount = 0;
	for (const user of users) {
		const role: OrganizationRole = user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() === APP_ADMIN_EMAIL ? "mentor" : "student";
		const existingMembership = existingMembershipByUserId.get(user.id);
		try {
			if (!existingMembership) {
				await createClerkMembership(env, clerkOrgId, user.id, role);
			} else if (existingMembership.role !== clerkRoleFor(role)) {
				await client.organizations.updateOrganizationMembership({
					organizationId: clerkOrgId,
					userId: user.id,
					role: clerkRoleFor(role),
				});
			}
			enrolledCount += 1;
		} catch (error) {
			enrollmentFailureCount += 1;
			console.error(JSON.stringify({
				message: "Could not sync an existing Clerk user to Waterloo Robotics",
				userId: user.id,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
		await db.prepare(`INSERT INTO organization_memberships (user_id, organization_id, role)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET organization_id = excluded.organization_id,
				role = CASE WHEN organization_memberships.role = 'mentor' THEN 'mentor' ELSE excluded.role END`)
			.bind(user.id, WATERLOO_ORGANIZATION_ID, role).run();
	}
	await getOrCreateJoinCode(db, WATERLOO_ORGANIZATION_ID);
	return {
		id: WATERLOO_ORGANIZATION_ID,
		clerk_organization_id: clerkOrgId,
		name: record.name,
		memberCount: enrolledCount,
		enrollmentFailureCount,
	};
}

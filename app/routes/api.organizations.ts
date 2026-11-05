import type { Route } from "./+types/api.organizations";
import {
	addOrganizationMember,
	authenticateOrganizationRequest,
	ensureAdminWaterlooMembership,
	getClerkClient,
	getOrganizationMembership,
	getOrCreateJoinCode,
	getPrimaryEmail,
	isAppAdmin,
	type OrganizationRole,
} from "../organizations.server";
import { cloudflareContext } from "../cloudflare-context";

type OrganizationEnv = Env & { SCOUTING_DB?: D1Database; CLERK_SECRET_KEY?: string };

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

function validRole(value: unknown): value is OrganizationRole {
	return value === "student" || value === "mentor" || value === "kiosk";
}

async function loadOrganization(db: D1Database, env: OrganizationEnv, userId: string) {
	const membership = await getOrganizationMembership(db, userId);
	if (!membership) return { organization: null, isAdmin: await isAppAdmin(env, userId) };
	const teams = await db.prepare("SELECT league, team_number FROM organization_teams WHERE organization_id = ? ORDER BY league, team_number")
		.bind(membership.organization_id).all<{ league: "FTC" | "FRC"; team_number: string }>();
	const organization = {
		id: membership.organization_id,
		name: membership.organization_name,
		clerkOrganizationId: membership.clerk_organization_id,
		role: membership.role,
		teams: teams.results,
	};
	if (membership.role !== "mentor") return { organization, isAdmin: await isAppAdmin(env, userId) };

	const [code, members] = await Promise.all([
		getOrCreateJoinCode(db, membership.organization_id),
		db.prepare("SELECT user_id, role FROM organization_memberships WHERE organization_id = ? ORDER BY role, created_at")
			.bind(membership.organization_id).all<{ user_id: string; role: OrganizationRole }>(),
	]);
	const client = getClerkClient(env);
	const memberDetails = await Promise.all(members.results.map(async (member) => {
		const user = await client.users.getUser(member.user_id);
		return {
			userId: user.id,
			name: user.fullName || user.username || "Account name unavailable",
			email: user.primaryEmailAddress?.emailAddress || "",
			role: member.role,
		};
	}));
	return { organization: { ...organization, joinCode: code, members: memberDetails }, isAdmin: await isAppAdmin(env, userId) };
}

async function enrollWhitelistedUser(db: D1Database, env: OrganizationEnv, userId: string) {
	const email = await getPrimaryEmail(env, userId);
	if (!email) return false;
	const allowed = await db.prepare(`SELECT o.id, o.clerk_organization_id, w.role
		FROM organization_email_whitelist w JOIN organizations o ON o.id = w.organization_id
		WHERE lower(w.email) = ?`)
		.bind(email).first<{ id: string; clerk_organization_id: string | null; role: OrganizationRole }>();
	if (!allowed?.clerk_organization_id) return false;
	await addOrganizationMember(db, env, {
		id: allowed.id,
		clerk_organization_id: allowed.clerk_organization_id,
	}, userId, allowed.role);
	return true;
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as OrganizationEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticateOrganizationRequest(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);
	try {
		if (!await getOrganizationMembership(env.SCOUTING_DB, session.sub)) {
			if (await isAppAdmin(env, session.sub)) {
				await ensureAdminWaterlooMembership(env.SCOUTING_DB, session.sub);
			} else {
				await enrollWhitelistedUser(env.SCOUTING_DB, env, session.sub);
			}
		}
		return json(await loadOrganization(env.SCOUTING_DB, env, session.sub));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not load organization membership", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not load organization settings." }, 503);
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as OrganizationEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticateOrganizationRequest(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	let body: { action?: unknown; code?: unknown; userId?: unknown; role?: unknown; name?: unknown; teams?: unknown };
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid organization request." }, 400);
	}

	const db = env.SCOUTING_DB;
	try {
		if (body.action === "join") {
			const member = await getOrganizationMembership(db, session.sub);
			if (member) return json({ error: `Your account already belongs to ${member.organization_name}.` }, 409);
			if (typeof body.code !== "string" || !/^[2-9A-HJ-NP-Z]{10,20}$/i.test(body.code.trim())) {
				return json({ error: "Enter a valid organization code." }, 400);
			}
			const organization = await db.prepare(`SELECT o.id, o.clerk_organization_id
				FROM organization_join_codes c JOIN organizations o ON o.id = c.organization_id
				WHERE upper(c.code) = upper(?)`)
				.bind(body.code.trim()).first<{ id: string; clerk_organization_id: string | null }>();
			if (!organization?.clerk_organization_id) return json({ error: "That organization code is invalid or inactive." }, 404);
			await addOrganizationMember(db, env, organization as { id: string; clerk_organization_id: string }, session.sub, "student");
			return json(await loadOrganization(db, env, session.sub));
		}

		const membership = await getOrganizationMembership(db, session.sub);
		if (!membership || membership.role !== "mentor") {
			return json({ error: "Only mentors in your organization can change organization settings." }, 403);
		}

		if (body.action === "rotate-code") {
			await db.prepare("DELETE FROM organization_join_codes WHERE organization_id = ?").bind(membership.organization_id).run();
			await getOrCreateJoinCode(db, membership.organization_id);
			return json(await loadOrganization(db, env, session.sub));
		}

		if (body.action === "set-role") {
			if (typeof body.userId !== "string" || !validRole(body.role)) return json({ error: "Choose a valid member and role." }, 400);
			if (body.userId === session.sub) return json({ error: "You cannot change your own organization role." }, 400);
			const target = await db.prepare("SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ?")
				.bind(membership.organization_id, body.userId).first<{ role: OrganizationRole }>();
			if (!target) return json({ error: "Organization member not found." }, 404);
			if (target.role === "mentor" && body.role !== "mentor") {
				const mentors = await db.prepare("SELECT COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND role = 'mentor'")
					.bind(membership.organization_id).first<{ count: number }>();
				if ((mentors?.count || 0) <= 1) return json({ error: "An organization must keep at least one mentor." }, 409);
			}
			if (!membership.clerk_organization_id) return json({ error: "Clerk organization setup is incomplete." }, 503);
			await getClerkClient(env).organizations.updateOrganizationMembership({
				organizationId: membership.clerk_organization_id,
				userId: body.userId,
				role: body.role === "mentor" ? "org:admin" : "org:member",
			});
			await db.prepare("UPDATE organization_memberships SET role = ? WHERE organization_id = ? AND user_id = ?")
				.bind(body.role, membership.organization_id, body.userId).run();
			return json(await loadOrganization(db, env, session.sub));
		}

		if (body.action === "remove-member") {
			if (typeof body.userId !== "string" || body.userId === session.sub) return json({ error: "Choose another organization member to remove." }, 400);
			const target = await db.prepare("SELECT role FROM organization_memberships WHERE organization_id = ? AND user_id = ?")
				.bind(membership.organization_id, body.userId).first<{ role: OrganizationRole }>();
			if (!target) return json({ error: "Organization member not found." }, 404);
			if (target.role === "mentor") {
				const mentors = await db.prepare("SELECT COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND role = 'mentor'")
					.bind(membership.organization_id).first<{ count: number }>();
				if ((mentors?.count || 0) <= 1) return json({ error: "An organization must keep at least one mentor." }, 409);
			}
			if (!membership.clerk_organization_id) return json({ error: "Clerk organization setup is incomplete." }, 503);
			await getClerkClient(env).organizations.deleteOrganizationMembership({
				organizationId: membership.clerk_organization_id,
				userId: body.userId,
			});
			await db.prepare("DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?")
				.bind(membership.organization_id, body.userId).run();
			return json(await loadOrganization(db, env, session.sub));
		}

		if (body.action === "save-settings" && Array.isArray(body.teams)) {
			return json({ error: "Only the site administrator can change organization team numbers." }, 403);
		}

		if (body.action === "save-name") {
			if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) {
				return json({ error: "Enter an organization name of up to 100 characters." }, 400);
			}
			if (!membership.clerk_organization_id) return json({ error: "Clerk organization setup is incomplete." }, 503);
			await getClerkClient(env).organizations.updateOrganization(membership.clerk_organization_id, { name: body.name.trim() });
			await db.prepare("UPDATE organizations SET name = ? WHERE id = ?")
				.bind(body.name.trim(), membership.organization_id).run();
			return json(await loadOrganization(db, env, session.sub));
		}

		return json({ error: "Choose a valid organization action." }, 400);
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not update organization", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: error instanceof Error ? error.message : "Could not update organization." }, 503);
	}
}

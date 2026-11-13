import { createClerkClient } from "@clerk/backend";
import type { Route } from "./+types/api.admin";
import {
	addOrganizationMember,
	APP_ADMIN_EMAIL,
	authenticateOrganizationRequest,
	ensureWaterlooOrganization,
	getOrganizationMembership,
	isAppAdmin,
	getPrimaryEmail,
	type OrganizationRole,
} from "../organizations.server";
import { cloudflareContext } from "../cloudflare-context";

type AdminEnv = Env & { SCOUTING_DB?: D1Database; CLERK_SECRET_KEY?: string };
type AccessRequest = {
	id: string;
	name: string;
	organization_name: string;
	email: string;
	role: OrganizationRole;
	message: string;
	team_numbers: string;
	organization_id: string | null;
	status: "pending" | "accepted" | "rejected";
	created_at: string;
};

function json(data: unknown, status = 200) {
	return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

function validRole(value: unknown): value is OrganizationRole {
	return value === "student" || value === "mentor" || value === "kiosk";
}

function validEmail(value: unknown): value is string {
	return typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function slugPart(value: string) {
	return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "robotics-team";
}

async function loadAdminData(db: D1Database, env: AdminEnv) {
	const [organizations, requests, whitelist, organizationTeams] = await Promise.all([
		db.prepare(`SELECT o.id, o.name, o.clerk_organization_id, COUNT(m.user_id) AS member_count
			FROM organizations o LEFT JOIN organization_memberships m ON m.organization_id = o.id
			GROUP BY o.id ORDER BY o.name`)
			.all<{ id: string; name: string; clerk_organization_id: string | null; member_count: number }>(),
		db.prepare(`SELECT id, name, organization_name, email, role, message, team_numbers, organization_id, status, created_at
			FROM organization_access_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`)
			.all<AccessRequest>(),
		db.prepare(`SELECT w.email, w.organization_id, w.role, w.added_at, o.name AS organization_name
			FROM organization_email_whitelist w JOIN organizations o ON o.id = w.organization_id
			ORDER BY lower(w.email)`).all(),
		db.prepare("SELECT organization_id, league, team_number FROM organization_teams ORDER BY organization_id, league, team_number")
			.all<{ organization_id: string; league: "FTC" | "FRC"; team_number: string }>(),
	]);
	const members = await db.prepare(`SELECT m.user_id, m.organization_id, m.role, o.name AS organization_name
		FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
		ORDER BY o.name, m.role, m.created_at`).all<{ user_id: string; organization_id: string; role: OrganizationRole; organization_name: string }>();
	const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY! });
	const memberDetails = await Promise.all(members.results.map(async (member) => {
		const user = await client.users.getUser(member.user_id);
		return {
			userId: member.user_id,
			organizationId: member.organization_id,
			organizationName: member.organization_name,
			name: user.fullName || user.username || "Account name unavailable",
			email: user.primaryEmailAddress?.emailAddress || "",
			role: member.role,
		};
	}));
	return {
		organizations: organizations.results.map((organization) => ({
			...organization,
			teams: organizationTeams.results
				.filter((team) => team.organization_id === organization.id)
				.map(({ league, team_number }) => ({ league, team_number })),
		})),
		requests: requests.results,
		whitelist: whitelist.results,
		members: memberDetails,
	};
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as AdminEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticateOrganizationRequest(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!await isAppAdmin(env, session.sub)) return json({ error: "Only the app administrator can manage organizations." }, 403);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);
	try {
		return json(await loadAdminData(env.SCOUTING_DB, env));
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not load organization admin panel", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not load organization admin data." }, 503);
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.get(cloudflareContext).env as AdminEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticateOrganizationRequest(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!await isAppAdmin(env, session.sub)) return json({ error: "Only the app administrator can manage organizations." }, 403);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);

	let body: {
		action?: unknown;
		requestId?: unknown;
		email?: unknown;
		organizationId?: unknown;
		role?: unknown;
		userId?: unknown;
		teams?: unknown;
	};
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid admin request." }, 400);
	}
	const db = env.SCOUTING_DB;
	const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
	try {
		if (body.action === "bootstrap-waterloo") {
			const organization = await ensureWaterlooOrganization(db, env, session.sub);
			return json({ organization });
		}

		if (body.action === "whitelist") {
			if (!validEmail(body.email) || typeof body.organizationId !== "string" || !validRole(body.role)) {
				return json({ error: "Enter a valid email, organization, and role." }, 400);
			}
			const organization = await db.prepare("SELECT id, clerk_organization_id FROM organizations WHERE id = ?")
				.bind(body.organizationId).first<{ id: string; clerk_organization_id: string | null }>();
			if (!organization) return json({ error: "Organization not found." }, 404);
			const users = await client.users.getUserList({ emailAddress: [body.email.trim().toLowerCase()], limit: 1 });
			if (users.data[0]) {
				const currentMembership = await getOrganizationMembership(db, users.data[0].id);
				if (currentMembership && currentMembership.organization_id !== organization.id) {
					return json({ error: `This account already belongs to ${currentMembership.organization_name}. Remove it from that organization before changing its access.` }, 409);
				}
			}
			await db.prepare(`INSERT INTO organization_email_whitelist (email, organization_id, role, added_by_user_id)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(email) DO UPDATE SET organization_id = excluded.organization_id, role = excluded.role, added_by_user_id = excluded.added_by_user_id`)
				.bind(body.email.trim().toLowerCase(), organization.id, body.role, session.sub).run();
			if (organization.clerk_organization_id) {
				if (users.data[0]) await addOrganizationMember(db, env, {
					id: organization.id,
					clerk_organization_id: organization.clerk_organization_id,
				}, users.data[0].id, body.role);
			}
			return json(await loadAdminData(db, env));
		}

		if (body.action === "remove-whitelist") {
			if (!validEmail(body.email)) return json({ error: "Choose a valid email to remove." }, 400);
			await db.prepare("DELETE FROM organization_email_whitelist WHERE lower(email) = ?")
				.bind(body.email.trim().toLowerCase()).run();
			return json(await loadAdminData(db, env));
		}

		if (body.action === "save-organization-teams") {
			if (typeof body.organizationId !== "string" || !Array.isArray(body.teams)) {
				return json({ error: "Choose an organization and provide its team numbers." }, 400);
			}
			const teams = body.teams.filter((team): team is { league: "FTC" | "FRC"; teamNumber: string } =>
				typeof team === "object" && team !== null &&
				((team as Record<string, unknown>).league === "FTC" || (team as Record<string, unknown>).league === "FRC") &&
				typeof (team as Record<string, unknown>).teamNumber === "string" &&
				/^\d{1,6}$/.test((team as Record<string, string>).teamNumber));
			if (teams.length !== body.teams.length || teams.length === 0 || teams.length > 30) {
				return json({ error: "Enter between 1 and 30 valid FTC or FRC team numbers." }, 400);
			}
			const uniqueTeams = [...new Map(teams.map((team) => [`${team.league}:${team.teamNumber}`, team])).values()];
			const organization = await db.prepare("SELECT id FROM organizations WHERE id = ?")
				.bind(body.organizationId).first<{ id: string }>();
			if (!organization) return json({ error: "Organization not found." }, 404);
			await db.batch([
				db.prepare("DELETE FROM organization_teams WHERE organization_id = ?").bind(organization.id),
				...uniqueTeams.map((team) => db.prepare("INSERT INTO organization_teams (organization_id, league, team_number) VALUES (?, ?, ?)")
					.bind(organization.id, team.league, team.teamNumber)),
			]);
			return json(await loadAdminData(db, env));
		}

		if (body.action === "accept-request") {
			if (typeof body.requestId !== "string") return json({ error: "Choose an access request." }, 400);
			const accessRequest = await db.prepare(`SELECT id, name, organization_name, email, role, team_numbers, organization_id, status
				FROM organization_access_requests WHERE id = ?`)
				.bind(body.requestId)
				.first<Pick<AccessRequest, "id" | "name" | "organization_name" | "email" | "role" | "team_numbers" | "organization_id" | "status">>();
			if (!accessRequest || accessRequest.status !== "pending") return json({ error: "Pending access request not found." }, 404);
			const teamNumbers = JSON.parse(accessRequest.team_numbers) as { league: "FTC" | "FRC"; teamNumber: string }[];
			const matchingUsers = await client.users.getUserList({ emailAddress: [accessRequest.email], limit: 1 });
			if (matchingUsers.data[0]) {
				const currentMembership = await getOrganizationMembership(db, matchingUsers.data[0].id);
				if (currentMembership && currentMembership.organization_id !== accessRequest.organization_id) {
					return json({ error: `This account already belongs to ${currentMembership.organization_name}. Remove it from that organization before approving this request.` }, 409);
				}
			}

			let organization: { id: string; clerk_organization_id: string };
			if (accessRequest.organization_id) {
				const existingOrganization = await db.prepare("SELECT id, clerk_organization_id FROM organizations WHERE id = ?")
					.bind(accessRequest.organization_id).first<{ id: string; clerk_organization_id: string | null }>();
				if (!existingOrganization?.clerk_organization_id) {
					return json({ error: "This request has an incomplete organization setup. Contact support before retrying." }, 503);
				}
				organization = { id: existingOrganization.id, clerk_organization_id: existingOrganization.clerk_organization_id };
			} else {
				const orgName = accessRequest.organization_name.trim();
				const clerkOrganization = await client.organizations.createOrganization({
					name: orgName,
					slug: `${slugPart(orgName)}-${crypto.randomUUID().slice(0, 8)}`,
					createdBy: session.sub,
					maxAllowedMemberships: 20,
				});
				const orgId = crypto.randomUUID();
				const statements = [
					db.prepare("INSERT INTO organizations (id, clerk_organization_id, name, created_by_user_id) VALUES (?, ?, ?, ?)")
						.bind(orgId, clerkOrganization.id, orgName, session.sub),
					...teamNumbers.map((team) => db.prepare("INSERT INTO organization_teams (organization_id, league, team_number) VALUES (?, ?, ?)")
						.bind(orgId, team.league, team.teamNumber)),
					db.prepare("UPDATE organization_access_requests SET organization_id = ? WHERE id = ? AND status = 'pending'")
						.bind(orgId, accessRequest.id),
				];
				try {
					await db.batch(statements);
				} catch (error) {
					await client.organizations.deleteOrganization({ organizationId: clerkOrganization.id });
					throw error;
				}
				organization = { id: orgId, clerk_organization_id: clerkOrganization.id };
			}
			await db.prepare(`INSERT INTO organization_email_whitelist (email, organization_id, role, added_by_user_id)
				VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET organization_id = excluded.organization_id, role = excluded.role,
				added_by_user_id = excluded.added_by_user_id`)
				.bind(accessRequest.email, organization.id, accessRequest.role, session.sub).run();
			if (matchingUsers.data[0]) {
				await addOrganizationMember(db, env, organization, matchingUsers.data[0].id, accessRequest.role);
			} else {
				let inviterUserId = session.sub;
				if (accessRequest.organization_id) {
					const mentor = await db.prepare(`SELECT user_id FROM organization_memberships
						WHERE organization_id = ? AND role = 'mentor' ORDER BY created_at LIMIT 1`)
						.bind(organization.id).first<{ user_id: string }>();
					if (mentor) {
						inviterUserId = mentor.user_id;
					} else {
						const adminMembership = await client.organizations.getOrganizationMembershipList({
							organizationId: organization.clerk_organization_id,
							userId: [session.sub],
							limit: 1,
						});
						if (!adminMembership.data.length) {
							return json({ error: "An organization mentor must be enrolled before this request can be approved." }, 409);
						}
					}
				}
				await client.organizations.createOrganizationInvitation({
					organizationId: organization.clerk_organization_id,
					emailAddress: accessRequest.email,
					role: accessRequest.role === "mentor" ? "org:admin" : "org:member",
					inviterUserId,
					redirectUrl: "https://5837scout.app/join",
				});
			}
			await db.prepare(`UPDATE organization_access_requests SET status = 'accepted', organization_id = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'pending'`)
				.bind(organization.id, accessRequest.id).run();
			if (!accessRequest.organization_id) {
				try {
					await client.organizations.deleteOrganizationMembership({
						organizationId: organization.clerk_organization_id,
						userId: session.sub,
					});
				} catch (error) {
					console.error(JSON.stringify({
						message: "Could not remove the temporary admin membership after organization approval",
						organizationId: organization.id,
						error: error instanceof Error ? error.message : String(error),
					}));
					return json({
						...await loadAdminData(db, env),
						warning: "The access request was approved, but the temporary administrator membership could not be removed.",
					});
				}
			}
			return json(await loadAdminData(db, env));
		}

		if (body.action === "reject-request") {
			if (typeof body.requestId !== "string") return json({ error: "Choose an access request." }, 400);
			const result = await db.prepare(`UPDATE organization_access_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'pending'`).bind(body.requestId).run();
			if (!result.meta.changes) return json({ error: "Pending access request not found." }, 404);
			return json(await loadAdminData(db, env));
		}

		if (body.action === "remove-member") {
			if (typeof body.userId !== "string" || typeof body.organizationId !== "string") {
				return json({ error: "Choose an organization member to remove." }, 400);
			}
			const target = await db.prepare(`SELECT m.role, o.clerk_organization_id FROM organization_memberships m
				JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ? AND m.organization_id = ?`)
				.bind(body.userId, body.organizationId)
				.first<{ role: OrganizationRole; clerk_organization_id: string | null }>();
			if (!target || !target.clerk_organization_id) return json({ error: "Organization member not found." }, 404);
			const ownerEmail = await getPrimaryEmail(env, body.userId);
			if (ownerEmail === APP_ADMIN_EMAIL) return json({ error: "The app administrator cannot be removed." }, 403);
			if (target.role === "mentor") {
				const mentors = await db.prepare("SELECT COUNT(*) AS count FROM organization_memberships WHERE organization_id = ? AND role = 'mentor'")
					.bind(body.organizationId).first<{ count: number }>();
				if ((mentors?.count || 0) <= 1) return json({ error: "This organization needs at least one mentor." }, 409);
			}
			await client.organizations.deleteOrganizationMembership({
				organizationId: target.clerk_organization_id,
				userId: body.userId,
			});
			await db.prepare("DELETE FROM organization_memberships WHERE user_id = ? AND organization_id = ?")
				.bind(body.userId, body.organizationId).run();
			return json(await loadAdminData(db, env));
		}

		return json({ error: "Choose a valid admin action." }, 400);
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not update organization admin data", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: error instanceof Error ? error.message : "Could not update organization admin data." }, 503);
	}
}

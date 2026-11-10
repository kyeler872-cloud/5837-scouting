import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.settings";
import { cloudflareContext } from "../cloudflare-context";
import { getAuditActor, getContributorSetup, getLocalContributorName, getLocalContributorSession } from "../audit.server";

type SettingsEnv = Env & { SCOUTING_DB?: D1Database };
type CompatibilityWeights = {
	flowerCapability: number;
	flowerTakeFrom: number;
	flowerInputInto: number;
	hiveCapability: number;
	hivePosition: number;
	hiveShooterType: number;
};
type DashboardShortcut = {
	id: string;
	kind: "event" | "team" | "comparison";
	label: string;
	league: "FTC" | "FRC";
	season: string;
	teamNumber?: string;
	eventCode?: string;
};
type PersonalSettings = {
	teamNumber: 5837;
	ftcTeamNumber: 7247 | 5445;
	teamPreset: "SLB" | "FTC";
	primaryLeague: "FTC" | "FRC";
	primaryTeamNumber: string;
	organizationTeams: { league: "FTC" | "FRC"; teamNumber: string }[];
	theme: "dark" | "light";
	searchLeague: "FTC" | "FRC";
	searchType: "team" | "event";
	shortcuts: DashboardShortcut[];
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
const defaultPersonalSettings: PersonalSettings = {
	teamNumber: 5837,
	ftcTeamNumber: 7247,
	teamPreset: "SLB",
	primaryLeague: "FTC",
	primaryTeamNumber: "7247",
	organizationTeams: [],
	theme: "dark",
	searchLeague: "FTC",
	searchType: "team",
	shortcuts: [],
};
const validFtcTeams = [7247, 5445] as const;

function isValidFtcTeamNumber(value: number): value is PersonalSettings["ftcTeamNumber"] {
	return validFtcTeams.some((teamNumber) => teamNumber === value);
}

function parseShortcuts(value: unknown): DashboardShortcut[] | null {
	if (!Array.isArray(value) || value.length > 12) return null;
	const shortcuts: DashboardShortcut[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) return null;
		const shortcut = item as Record<string, unknown>;
		if (
			typeof shortcut.id !== "string" || !/^[\da-f-]{1,60}$/i.test(shortcut.id) ||
			typeof shortcut.label !== "string" || !shortcut.label.trim() || shortcut.label.length > 100 ||
			(shortcut.kind !== "event" && shortcut.kind !== "team" && shortcut.kind !== "comparison") ||
			(shortcut.league !== "FTC" && shortcut.league !== "FRC") ||
			typeof shortcut.season !== "string" || !/^\d{4}$/.test(shortcut.season)
		) return null;
		if (shortcut.kind === "event") {
			if (typeof shortcut.eventCode !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(shortcut.eventCode)) return null;
			shortcuts.push({ id: shortcut.id, kind: "event", label: shortcut.label.trim(), league: shortcut.league, season: shortcut.season, eventCode: shortcut.eventCode });
		} else {
			if (typeof shortcut.teamNumber !== "string" || !/^\d{1,6}$/.test(shortcut.teamNumber)) return null;
			shortcuts.push({ id: shortcut.id, kind: shortcut.kind, label: shortcut.label.trim(), league: shortcut.league, season: shortcut.season, teamNumber: shortcut.teamNumber });
		}
	}
	return shortcuts;
}

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

async function readPersonalSettings(db: D1Database, userId: string): Promise<PersonalSettings> {
	const [row, membership] = await Promise.all([
		db.prepare("SELECT team_number, ftc_team_number, team_preset, primary_league, primary_team_number, theme, search_league, search_type, shortcuts FROM user_settings WHERE user_id = ?")
		.bind(userId)
		.first<{ team_number: number; ftc_team_number: number; team_preset: string; primary_league: string; primary_team_number: string; theme: string; search_league: string; search_type: string; shortcuts: string }>(),
		db.prepare("SELECT organization_id FROM organization_memberships WHERE user_id = ?")
			.bind(userId).first<{ organization_id: string }>(),
	]);
	const teams = membership
		? await db.prepare("SELECT league, team_number FROM organization_teams WHERE organization_id = ? ORDER BY league, team_number")
			.bind(membership.organization_id).all<{ league: "FTC" | "FRC"; team_number: string }>()
		: { results: [] };
	const organizationTeams = teams.results.map(({ league, team_number }) => ({ league, teamNumber: team_number }));
	const defaultTeam = organizationTeams.find((team) => team.league === "FTC") || organizationTeams[0] || {
		league: "FTC" as const,
		teamNumber: defaultPersonalSettings.primaryTeamNumber,
	};
	if (!row) {
		const isWaterloo = membership?.organization_id === "waterloo-robotics";
		return {
			...defaultPersonalSettings,
			teamPreset: isWaterloo ? "SLB" : "FTC",
			primaryLeague: defaultTeam.league,
			primaryTeamNumber: defaultTeam.teamNumber,
			organizationTeams,
		};
	}
	let parsedShortcuts: unknown;
	try {
		parsedShortcuts = JSON.parse(row.shortcuts);
	} catch {
		parsedShortcuts = [];
	}
	const primaryLeague: PersonalSettings["primaryLeague"] = row.primary_league === "FRC" ? "FRC" : "FTC";
	const selectedTeamIsAvailable = organizationTeams.some((team) =>
		team.league === primaryLeague && team.teamNumber === row.primary_team_number
	);
	const selectedTeam = selectedTeamIsAvailable
		? { league: primaryLeague, teamNumber: row.primary_team_number }
		: defaultTeam;
	const hasWaterlooTeams = ["FRC:5837", "FTC:7247", "FTC:5445"].every((teamKey) =>
		organizationTeams.some((team) => `${team.league}:${team.teamNumber}` === teamKey)
	);
	const teamPreset: PersonalSettings["teamPreset"] =
		row.team_preset === "SLB" && membership?.organization_id === "waterloo-robotics" && hasWaterlooTeams ? "SLB" : "FTC";
	const selectedFtcTeamNumber = Number(selectedTeam.teamNumber);
	return {
		teamNumber: 5837,
		ftcTeamNumber: selectedTeam.league === "FTC" && isValidFtcTeamNumber(selectedFtcTeamNumber)
			? selectedFtcTeamNumber
			: isValidFtcTeamNumber(row.ftc_team_number) ? row.ftc_team_number : defaultPersonalSettings.ftcTeamNumber,
		teamPreset,
		primaryLeague: selectedTeam.league,
		primaryTeamNumber: selectedTeam.teamNumber,
		organizationTeams,
		theme: row.theme === "light" ? "light" : "dark",
		searchLeague: row.search_league === "FRC" ? "FRC" : "FTC",
		searchType: row.search_type === "event" ? "event" : "team",
		shortcuts: parseShortcuts(parsedShortcuts) || [],
	};
}

async function readAccountPersonalSettings(env: SettingsEnv, userId: string) {
	if (!env.SCOUTING_DB) throw new Error("Shared scouting storage is not configured.");
	const [loadedPersonal, contributor] = await Promise.all([
		readPersonalSettings(env.SCOUTING_DB, userId),
		getContributorSetup(env, userId),
	]);
	let personal = loadedPersonal;
	if (contributor.kiosk) {
		const defaultTeam = personal.organizationTeams.find((team) => team.league === "FTC") || personal.organizationTeams[0];
		if (defaultTeam) {
			personal = {
				...personal,
				teamPreset: "FTC",
				primaryLeague: defaultTeam.league,
				primaryTeamNumber: defaultTeam.teamNumber,
				ftcTeamNumber: defaultTeam.league === "FTC" && isValidFtcTeamNumber(Number(defaultTeam.teamNumber))
					? Number(defaultTeam.teamNumber)
					: personal.ftcTeamNumber,
			};
		}
	}
	return {
		personal: contributor.required && !contributor.kiosk
			? { ...personal, teamNumber: 5837 as const, ftcTeamNumber: 7247 as const, teamPreset: "SLB" as const, primaryLeague: "FTC" as const, primaryTeamNumber: "7247" }
			: personal,
		teamSelectionLocked: contributor.required,
		kiosk: contributor.kiosk,
	};
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.get(cloudflareContext).env as SettingsEnv;
	if (!env.CLERK_SECRET_KEY) return json({ error: "Server authentication is not configured." }, 503);
	const session = await authenticate(request, env);
	if (!session) return json({ error: "Authentication required." }, 401);
	if (!env.SCOUTING_DB) return json({ error: "Shared scouting storage is not configured." }, 503);
	try {
		if (new URL(request.url).searchParams.get("scope") === "contributor") {
			const setup = await getContributorSetup(env, session.sub);
			const localSession = setup.required ? getLocalContributorSession(request) : { name: null, expiresAt: null };
			return json({ contributor: { ...setup, ...localSession } });
		}
		const accountSettings = await readAccountPersonalSettings(env, session.sub);
		if (new URL(request.url).searchParams.get("scope") === "personal") return json(accountSettings);
		return json({ ...await readSettings(env.SCOUTING_DB), ...accountSettings });
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

	let body: {
		action?: unknown;
		contributorName?: unknown;
		weights?: unknown;
		personal?: {
			teamNumber?: unknown;
			ftcTeamNumber?: unknown;
			teamPreset?: unknown;
			primaryLeague?: unknown;
			primaryTeamNumber?: unknown;
			theme?: unknown;
			searchLeague?: unknown;
			searchType?: unknown;
			shortcuts?: unknown;
		};
	};
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid compatibility settings payload." }, 400);
	}
	if (body.action === "contributor-name") {
		if (typeof body.contributorName !== "string") return json({ error: "Enter a credited name." }, 400);
		const name = body.contributorName.trim();
		if (!name || name.length > 80 || /[\r\n\0]/.test(name)) return json({ error: "Enter a name from 1 to 80 characters." }, 400);
		try {
			const setup = await getContributorSetup(env, session.sub);
			if (!setup.required) return json({ error: "Credited names are only available for kiosk accounts and the designated account." }, 403);
			const expiresInSeconds = setup.kiosk ? 3600 : 31_536_000;
			const expiresAtMs = Date.now() + expiresInSeconds * 1000;
			const expiresAt = new Date(expiresAtMs).toISOString();
			const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
			const headers = new Headers({
				"cache-control": "private, no-store",
				"content-type": "application/json",
			});
			headers.append("set-cookie", `scouting-contributor-name=${encodeURIComponent(name)}; Path=/; Max-Age=${expiresInSeconds}; SameSite=Lax${secure}`);
			headers.append("set-cookie", `scouting-contributor-expires-at=${expiresAtMs}; Path=/; Max-Age=${expiresInSeconds}; SameSite=Lax${secure}`);
			return new Response(JSON.stringify({ contributor: { required: true, kiosk: setup.kiosk, name, expiresAt } }), { headers });
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not save contributor name", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not save your credited name." }, 503);
		}
	}
	if (body.personal) {
		const { teamNumber, ftcTeamNumber, teamPreset, primaryLeague, primaryTeamNumber, theme, searchLeague, searchType } = body.personal;
		let contributorSetup: Awaited<ReturnType<typeof getContributorSetup>>;
		try {
			contributorSetup = await getContributorSetup(env, session.sub);
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not verify account team settings", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not verify your account team settings." }, 503);
		}
		let membership: { organization_id: string } | null;
		let organizationTeams: { results: { league: "FTC" | "FRC"; team_number: string }[] };
		try {
			membership = await env.SCOUTING_DB.prepare(`SELECT o.id AS organization_id FROM organization_memberships m
				JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?`)
				.bind(session.sub).first<{ organization_id: string }>();
			organizationTeams = membership
				? await env.SCOUTING_DB.prepare("SELECT league, team_number FROM organization_teams WHERE organization_id = ? ORDER BY league, team_number")
					.bind(membership.organization_id).all<{ league: "FTC" | "FRC"; team_number: string }>()
				: { results: [] };
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not verify organization team settings", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not verify your organization teams." }, 503);
		}
		const selectedTeamExists = typeof primaryLeague === "string" && typeof primaryTeamNumber === "string" &&
			organizationTeams.results.some((team) => team.league === primaryLeague && team.team_number === primaryTeamNumber);
		const hasWaterlooTeams = ["FRC:5837", "FTC:7247", "FTC:5445"].every((teamKey) =>
			organizationTeams.results.some((team) => `${team.league}:${team.team_number}` === teamKey)
		);
		if (
			teamNumber !== 5837 ||
			typeof ftcTeamNumber !== "number" ||
			(!isValidFtcTeamNumber(ftcTeamNumber) && !(primaryLeague === "FTC" && primaryTeamNumber === String(ftcTeamNumber))) ||
			(teamPreset !== "SLB" && teamPreset !== "FTC") ||
			(primaryLeague !== "FTC" && primaryLeague !== "FRC") ||
			!selectedTeamExists ||
			(teamPreset === "SLB" && (membership?.organization_id !== "waterloo-robotics" || !hasWaterlooTeams || primaryLeague !== "FTC" || primaryTeamNumber !== "7247")) ||
			(theme !== "dark" && theme !== "light") ||
			(searchLeague !== undefined && searchLeague !== "FTC" && searchLeague !== "FRC") ||
			(searchType !== undefined && searchType !== "team" && searchType !== "event")
		) {
			return json({ error: "Choose a valid team, theme, and search preference." }, 400);
		}
		if (contributorSetup.kiosk) {
			const kioskTeam = organizationTeams.results.find((team) => team.league === "FTC") || organizationTeams.results[0];
			if (!kioskTeam || teamPreset !== "FTC" || primaryLeague !== kioskTeam.league || primaryTeamNumber !== kioskTeam.team_number) {
				return json({ error: "Kiosk accounts are assigned to every team in their organization and cannot change their dashboard team." }, 403);
			}
		} else if (contributorSetup.required && (teamPreset !== "SLB" || primaryLeague !== "FTC" || primaryTeamNumber !== "7247")) {
			return json({ error: "This account's team membership is locked to FRC 5837 and FTC 7247 + 5445." }, 403);
		}
		try {
			const currentPersonal = await readPersonalSettings(env.SCOUTING_DB, session.sub);
			const shortcuts = body.personal.shortcuts === undefined
				? currentPersonal.shortcuts
				: parseShortcuts(body.personal.shortcuts);
			if (!shortcuts) return json({ error: "Add up to 12 valid dashboard shortcuts." }, 400);
			const selectedSearchLeague = searchLeague === "FRC" ? "FRC" : searchLeague === "FTC" ? "FTC" : currentPersonal.searchLeague;
			const selectedSearchType = searchType === "event" ? "event" : searchType === "team" ? "team" : currentPersonal.searchType;
			const legacyFtcTeam = isValidFtcTeamNumber(Number(primaryTeamNumber)) && primaryLeague === "FTC"
				? Number(primaryTeamNumber)
				: isValidFtcTeamNumber(ftcTeamNumber) ? ftcTeamNumber : defaultPersonalSettings.ftcTeamNumber;
			await env.SCOUTING_DB.prepare(`INSERT INTO user_settings
				(user_id, team_number, ftc_team_number, team_preset, primary_league, primary_team_number, theme, search_league, search_type, shortcuts, updated_at)
				VALUES (?, 5837, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(user_id) DO UPDATE SET team_number = 5837, ftc_team_number = excluded.ftc_team_number,
				team_preset = excluded.team_preset, primary_league = excluded.primary_league,
				primary_team_number = excluded.primary_team_number, theme = excluded.theme,
				search_league = excluded.search_league, search_type = excluded.search_type,
				shortcuts = excluded.shortcuts, updated_at = excluded.updated_at`)
				.bind(session.sub, legacyFtcTeam, teamPreset, primaryLeague, primaryTeamNumber, theme, selectedSearchLeague, selectedSearchType, JSON.stringify(shortcuts))
				.run();
			return json(await readAccountPersonalSettings(env, session.sub));
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not save personal settings", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not save personal settings. Confirm the latest database migration has been applied." }, 503);
		}
	}
	const weights = parseWeights(body.weights);
	if (!weights) return json({ error: "Each compatibility influence must be a number from 0 to 100." }, 400);

	try {
		const actor = await getAuditActor(env, session.sub, getLocalContributorName(request), true);
		await env.SCOUTING_DB.prepare(`INSERT INTO compatibility_settings (id, weights, updated_by_account_name, updated_at)
			VALUES ('global', ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(id) DO UPDATE SET weights = excluded.weights, updated_by_account_name = excluded.updated_by_account_name, updated_at = excluded.updated_at`)
			.bind(JSON.stringify(weights), actor.accountName)
			.run();
		return json({ ...await readSettings(env.SCOUTING_DB), ...await readAccountPersonalSettings(env, session.sub) });
	} catch (error) {
		console.error(JSON.stringify({ message: "Could not save compatibility settings", error: error instanceof Error ? error.message : String(error) }));
		return json({ error: "Could not save compatibility settings. Confirm the latest database migration has been applied." }, 503);
	}
}

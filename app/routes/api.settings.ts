import { verifyToken } from "@clerk/backend";
import type { Route } from "./+types/api.settings";
import { cloudflareContext } from "../cloudflare-context";
import { getAuditActor, getContributorSetup, getLocalContributorName } from "../audit.server";

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
	theme: "dark" | "light";
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
	theme: "dark",
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
	const row = await db.prepare("SELECT team_number, ftc_team_number, team_preset, theme, shortcuts FROM user_settings WHERE user_id = ?")
		.bind(userId)
		.first<{ team_number: number; ftc_team_number: number; team_preset: string; theme: string; shortcuts: string }>();
	if (!row) return defaultPersonalSettings;
	let parsedShortcuts: unknown;
	try {
		parsedShortcuts = JSON.parse(row.shortcuts);
	} catch {
		parsedShortcuts = [];
	}
	const teamPreset: PersonalSettings["teamPreset"] = row.team_preset === "FTC" ? "FTC" : "SLB";
	return {
		teamNumber: 5837,
		ftcTeamNumber: teamPreset === "SLB"
			? 7247
			: isValidFtcTeamNumber(row.ftc_team_number) ? row.ftc_team_number : defaultPersonalSettings.ftcTeamNumber,
		teamPreset,
		theme: row.theme === "light" ? "light" : "dark",
		shortcuts: parseShortcuts(parsedShortcuts) || [],
	};
}

async function readAccountPersonalSettings(env: SettingsEnv, userId: string) {
	if (!env.SCOUTING_DB) throw new Error("Shared scouting storage is not configured.");
	const [personal, contributor] = await Promise.all([
		readPersonalSettings(env.SCOUTING_DB, userId),
		getContributorSetup(env, userId),
	]);
	return {
		personal: contributor.required
			? { ...personal, teamNumber: 5837 as const, ftcTeamNumber: 7247 as const, teamPreset: "SLB" as const }
			: personal,
		teamSelectionLocked: contributor.required,
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
			return json({ contributor: { ...setup, name: setup.required ? getLocalContributorName(request) : null } });
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
		personal?: { teamNumber?: unknown; ftcTeamNumber?: unknown; teamPreset?: unknown; theme?: unknown; shortcuts?: unknown };
	};
	try {
		body = await request.json() as typeof body;
	} catch {
		return json({ error: "Invalid compatibility settings payload." }, 400);
	}
	if (body.action === "contributor-name") {
		if (typeof body.contributorName !== "string") return json({ error: "Enter a credited name." }, 400);
		const name = body.contributorName.trim();
		if (!name || name.length > 12 || /[\r\n\0]/.test(name)) return json({ error: "Enter a name from 1 to 12 characters." }, 400);
		try {
			const setup = await getContributorSetup(env, session.sub);
			if (!setup.required) return json({ error: "Credited names are only available for the designated account." }, 403);
			const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
			return new Response(JSON.stringify({ contributor: { required: true, name, expiresAt: null } }), {
				headers: {
					"cache-control": "private, no-store",
					"content-type": "application/json",
					"set-cookie": `scouting-contributor-name=${encodeURIComponent(name)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`,
				},
			});
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not save contributor name", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not save your credited name." }, 503);
		}
	}
	if (body.personal) {
		const { teamNumber, ftcTeamNumber, teamPreset, theme } = body.personal;
		let teamSelectionLocked = false;
		try {
			teamSelectionLocked = (await getContributorSetup(env, session.sub)).required;
		} catch (error) {
			console.error(JSON.stringify({ message: "Could not verify account team settings", error: error instanceof Error ? error.message : String(error) }));
			return json({ error: "Could not verify your account team settings." }, 503);
		}
		if (
			teamNumber !== 5837 ||
			typeof ftcTeamNumber !== "number" ||
			!isValidFtcTeamNumber(ftcTeamNumber) ||
			(teamPreset !== "SLB" && teamPreset !== "FTC") ||
			(teamPreset === "SLB" && ftcTeamNumber !== 7247) ||
			(theme !== "dark" && theme !== "light")
		) {
			return json({ error: "Choose a valid team and theme." }, 400);
		}
		if (teamSelectionLocked && (teamPreset !== "SLB" || ftcTeamNumber !== 7247)) {
			return json({ error: "This account's team membership is locked to FRC 5837 and FTC 7247 + 5445." }, 403);
		}
		try {
			const shortcuts = body.personal.shortcuts === undefined
				? (await readPersonalSettings(env.SCOUTING_DB, session.sub)).shortcuts
				: parseShortcuts(body.personal.shortcuts);
			if (!shortcuts) return json({ error: "Add up to 12 valid dashboard shortcuts." }, 400);
			await env.SCOUTING_DB.prepare(`INSERT INTO user_settings (user_id, team_number, ftc_team_number, team_preset, theme, shortcuts, updated_at)
				VALUES (?, 5837, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				ON CONFLICT(user_id) DO UPDATE SET team_number = 5837, ftc_team_number = excluded.ftc_team_number,
				team_preset = excluded.team_preset, theme = excluded.theme, shortcuts = excluded.shortcuts, updated_at = excluded.updated_at`)
				.bind(session.sub, ftcTeamNumber, teamPreset, theme, JSON.stringify(shortcuts))
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

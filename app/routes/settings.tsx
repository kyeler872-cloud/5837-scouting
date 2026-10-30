import { useAuth } from "@clerk/react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/settings";
import { Protected } from "../protected";
import { TopNavigation } from "../components/top-navigation";

type AuditLog = {
	id: string;
	created_at: string;
	account_name: string;
	email: string | null;
	action: string;
	target: string;
	previous_text: string | null;
	new_text: string | null;
};

type WhitelistEntry = {
	id: string;
	email: string | null;
	account_name: string | null;
	added_at: string;
};

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
type PersonalSettings = { teamNumber: number; theme: "dark" | "light"; shortcuts: DashboardShortcut[] };
type CompatibilitySettings = { weights: CompatibilityWeights; updatedBy: string | null; updatedAt: string | null; personal: PersonalSettings };

const defaultWeights: CompatibilityWeights = {
	flowerCapability: 50,
	flowerTakeFrom: 50,
	flowerInputInto: 50,
	hiveCapability: 50,
	hivePosition: 50,
	hiveShooterType: 50,
};

function WeightSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
	return <label className="compatibility-weight">
		<span>{label}</span>
		<input type="range" min="0" max="100" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
		<output>{value}%</output>
	</label>;
}

async function parseResponse<T>(response: Response): Promise<T & { error?: string }> {
	const text = await response.text();
	try {
		return JSON.parse(text) as T & { error?: string };
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Settings | Scout 5837" }, { name: "description", content: "Shared FTC team-compatibility settings and restricted audit logs." }];
}

export default function SettingsPage() {
	const { getToken } = useAuth();
	const [logs, setLogs] = useState<AuditLog[]>([]);
	const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
	const [canManageWhitelist, setCanManageWhitelist] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [isAllowed, setIsAllowed] = useState<boolean | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [accountName, setAccountName] = useState("");
	const [email, setEmail] = useState("");
	const [error, setError] = useState("");
	const [weights, setWeights] = useState<CompatibilityWeights>(defaultWeights);
	const [updatedBy, setUpdatedBy] = useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [isLoadingWeights, setIsLoadingWeights] = useState(true);
	const [isSavingWeights, setIsSavingWeights] = useState(false);
	const [settingsError, setSettingsError] = useState("");
	const [settingsNotice, setSettingsNotice] = useState("");
	const [personal, setPersonal] = useState<PersonalSettings>({ teamNumber: 5837, theme: "dark", shortcuts: [] });
	const [isSavingPersonal, setIsSavingPersonal] = useState(false);
	const [personalError, setPersonalError] = useState("");
	const [personalNotice, setPersonalNotice] = useState("");

	async function loadCompatibilitySettings() {
		setIsLoadingWeights(true);
		setSettingsError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
			const data = await parseResponse<CompatibilitySettings>(response);
			if (!response.ok) throw new Error(data.error || "Could not load compatibility settings.");
			setWeights(data.weights);
			setUpdatedBy(data.updatedBy);
			setUpdatedAt(data.updatedAt);
			setPersonal(data.personal);
		} catch (loadError) {
			setSettingsError(loadError instanceof Error ? loadError.message : "Could not load compatibility settings.");
		} finally {
			setIsLoadingWeights(false);
		}
	}

	async function savePersonalSettings(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSavingPersonal(true);
		setPersonalError("");
		setPersonalNotice("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ personal }),
			});
			const data = await parseResponse<{ personal?: PersonalSettings }>(response);
			if (!response.ok || !data.personal) throw new Error(data.error || "Could not save personal settings.");
			setPersonal(data.personal);
			document.documentElement.dataset.theme = data.personal.theme;
			setPersonalNotice("Personal settings saved.");
		} catch (saveError) {
			setPersonalError(saveError instanceof Error ? saveError.message : "Could not save personal settings.");
		} finally {
			setIsSavingPersonal(false);
		}
	}

	async function loadLogs(append = false) {
		if (!append) setIsLoading(true);
		setError("");
		try {
			const params = new URLSearchParams();
			if (append && logs.length) {
				const last = logs[logs.length - 1];
				params.set("beforeTime", last.created_at);
				params.set("beforeId", last.id);
			}
			const token = await getToken();
			const response = await fetch(`/api/logs${params.size ? `?${params}` : ""}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			});
			const data = await parseResponse<{ logs?: AuditLog[]; whitelist?: WhitelistEntry[]; canManageWhitelist?: boolean; hasMore?: boolean }>(response);
			if (response.status === 403) {
				setIsAllowed(false);
				setLogs([]);
				return;
			}
			if (!response.ok) throw new Error(data.error || "Could not load debug logs.");
			setIsAllowed(true);
			setLogs((current) => append ? [...current, ...(data.logs || [])] : data.logs || []);
			setWhitelist(data.whitelist || []);
			setCanManageWhitelist(Boolean(data.canManageWhitelist));
			setHasMore(Boolean(data.hasMore));
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "Could not load debug logs.");
		} finally {
			setIsLoading(false);
		}
	}

	useEffect(() => {
		void loadLogs();
		void loadCompatibilitySettings();
	}, [getToken]);

	async function saveCompatibilitySettings(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSavingWeights(true);
		setSettingsError("");
		setSettingsNotice("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ weights }),
			});
			const data = await parseResponse<CompatibilitySettings>(response);
			if (!response.ok) throw new Error(data.error || "Could not save compatibility settings.");
			setWeights(data.weights);
			setUpdatedBy(data.updatedBy);
			setUpdatedAt(data.updatedAt);
			setSettingsNotice("Shared compatibility influences saved.");
		} catch (saveError) {
			setSettingsError(saveError instanceof Error ? saveError.message : "Could not save compatibility settings.");
		} finally {
			setIsSavingWeights(false);
		}
	}

	async function updateWhitelist(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsSaving(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/logs", {
				method: "POST",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ action: "add", email, accountName }),
			});
			const data = await parseResponse<{ whitelist?: WhitelistEntry[] }>(response);
			if (!response.ok) throw new Error(data.error || "Could not add whitelist entry.");
			setWhitelist(data.whitelist || []);
			setEmail("");
			setAccountName("");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not add whitelist entry.");
		} finally {
			setIsSaving(false);
		}
	}

	async function removeWhitelistEntry(id: string) {
		setIsSaving(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/logs", {
				method: "POST",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ action: "remove", id }),
			});
			const data = await parseResponse<{ whitelist?: WhitelistEntry[] }>(response);
			if (!response.ok) throw new Error(data.error || "Could not remove whitelist entry.");
			setWhitelist(data.whitelist || []);
		} catch (removeError) {
			setError(removeError instanceof Error ? removeError.message : "Could not remove whitelist entry.");
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<Protected>
			<main className="home-shell">
				<TopNavigation currentPage="settings" />
				<div className="logs-page">
					<header className="logs-heading">
						<p className="section-kicker">Account preferences</p>
						<h1>Settings</h1>
						<p>Choose your team and display theme, then review the shared scouting settings available to your account.</p>
					</header>
					{error && <p className="lookup-error" role="alert">{error}</p>}
					{settingsError && <p className="lookup-error" role="alert">{settingsError}</p>}
					<section className="personal-settings" aria-labelledby="personal-settings-title">
						<header className="settings-section-heading">
							<p className="section-kicker">Your account</p>
							<h2 id="personal-settings-title">Personal Settings</h2>
						</header>
						{personalError && <p className="lookup-error" role="alert">{personalError}</p>}
						{personalNotice && <p className="settings-saved" role="status">{personalNotice}</p>}
						<form className="personal-settings-form" onSubmit={(event) => void savePersonalSettings(event)}>
							<label>Team
								<select value={personal.teamNumber === 5837 ? "" : personal.teamNumber} onChange={(event) => setPersonal((current) => ({ ...current, teamNumber: Number(event.target.value) }))}>
									<option value="" disabled>Select an FTC team</option>
									<option value={7247}>FTC 7247</option>
									<option value={5445}>FTC 5445</option>
								</select>
								<small className="personal-team-default">{personal.teamNumber === 5837 ? "Default team: FRC 5837" : "FRC 5837 is the default for new accounts."}</small>
							</label>
							<fieldset className="theme-choice">
								<legend>Appearance</legend>
								<label><input type="radio" name="theme" value="dark" checked={personal.theme === "dark"} onChange={() => setPersonal((current) => ({ ...current, theme: "dark" }))} /> Dark</label>
								<label><input type="radio" name="theme" value="light" checked={personal.theme === "light"} onChange={() => setPersonal((current) => ({ ...current, theme: "light" }))} /> Light</label>
							</fieldset>
							<button className="search-button" type="submit" disabled={isSavingPersonal}>{isSavingPersonal ? "Saving..." : "Save personal settings"}</button>
						</form>
					</section>
					<section className="universal-settings" aria-labelledby="universal-settings-title">
						<header className="settings-section-heading">
							<p className="section-kicker">Shared across accounts</p>
							<h2 id="universal-settings-title">Universal Settings</h2>
						</header>
						{settingsNotice && <p className="settings-saved" role="status">{settingsNotice}</p>}
					<section className="compatibility-settings" aria-labelledby="compatibility-title">
						<header className="compatibility-settings-heading">
							<div>
								<p className="section-kicker">FTC 2026–27</p>
								<h2 id="compatibility-title">Team compatibility influences</h2>
								<p>Set how strongly each scoring capability should affect future FTC matching. These influences are shared by all accounts.</p>
							</div>
						</header>
						{isLoadingWeights ? <p className="logs-status" aria-busy="true">Loading shared influences...</p> : <>
							<form className="compatibility-settings-form" onSubmit={(event) => void saveCompatibilitySettings(event)}>
								<div className="compatibility-weight-groups">
									<details className="compatibility-weight-group" open>
										<summary><span>Flower</span><small>Scoring and handling</small></summary>
										<div className="compatibility-weight-fields">
											<WeightSlider label="Flower capability" value={weights.flowerCapability} onChange={(value) => setWeights((current) => ({ ...current, flowerCapability: value }))} />
											<WeightSlider label="Take from" value={weights.flowerTakeFrom} onChange={(value) => setWeights((current) => ({ ...current, flowerTakeFrom: value }))} />
											<WeightSlider label="Input into" value={weights.flowerInputInto} onChange={(value) => setWeights((current) => ({ ...current, flowerInputInto: value }))} />
										</div>
									</details>
									<details className="compatibility-weight-group" open>
										<summary><span>Hive</span><small>Scoring capability</small></summary>
										<div className="compatibility-weight-fields">
											<WeightSlider label="Hive capability" value={weights.hiveCapability} onChange={(value) => setWeights((current) => ({ ...current, hiveCapability: value }))} />
											<details className="compatibility-weight-subgroup" open>
												<summary>Shooter</summary>
												<div className="compatibility-weight-fields">
													<WeightSlider label="Position" value={weights.hivePosition} onChange={(value) => setWeights((current) => ({ ...current, hivePosition: value }))} />
													<WeightSlider label="Fixed / Dynamic type" value={weights.hiveShooterType} onChange={(value) => setWeights((current) => ({ ...current, hiveShooterType: value }))} />
												</div>
											</details>
										</div>
									</details>
								</div>
								<div className="compatibility-settings-actions">
									<button className="search-button" type="submit" disabled={isSavingWeights}>{isSavingWeights ? "Saving..." : "Save shared influences"}</button>
									<span>{updatedBy ? `Last updated by ${updatedBy}${updatedAt ? ` · ${new Date(`${updatedAt.replace(" ", "T")}Z`).toLocaleString()}` : ""}` : "Shared default influences · not edited yet"}</span>
								</div>
							</form>
						</>}
					</section>
					{isLoading && <p className="logs-status" aria-busy="true">Checking audit-log access...</p>}
					{!isLoading && isAllowed === false && <section className="logs-denied" role="status">
						<h3>Debug log</h3>
						<p>Compatibility settings are available to signed-in users. Audit logs and access management are limited to approved accounts.</p>
					</section>}
					{!isLoading && isAllowed && <>
						{canManageWhitelist && <section className="logs-whitelist">
							<h3>Debug log access</h3>
							<form onSubmit={(event) => void updateWhitelist(event)}>
								<label>Account name<input maxLength={100} value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Full name" /></label>
								<label>Email address<input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
								<button className="search-button" type="submit" disabled={isSaving || (!accountName.trim() && !email.trim())}>{isSaving ? "Saving..." : "Whitelist access"}</button>
							</form>
							{whitelist.length > 0 ? <ul>{whitelist.map((entry) => <li key={entry.id}>
								<span>{entry.account_name || "Name not set"}{entry.email ? ` · ${entry.email}` : ""}</span>
								<button type="button" disabled={isSaving} onClick={() => void removeWhitelistEntry(entry.id)}>Remove</button>
							</li>)}</ul> : <p>No additional accounts are whitelisted.</p>}
						</section>}
						<section className="logs-list" aria-labelledby="logs-title">
							<h3 id="logs-title">Debug log</h3>
							{logs.length ? <div className="logs-table-wrap"><table>
								<thead><tr><th>Date and time</th><th>Account</th><th>Edit</th><th>Target</th></tr></thead>
								<tbody>{logs.map((log) => <tr key={log.id}>
									<td>{new Date(`${log.created_at.replace(" ", "T")}Z`).toLocaleString()}</td>
									<td>{log.account_name}{log.email && <small>{log.email}</small>}</td>
									<td>
										{log.action}
										<details className="log-comparison">
											<summary>Compare values</summary>
											<div className="log-comparison-columns">
												<section><h3>Previous</h3><pre>{log.previous_text ?? "(No previous value)"}</pre></section>
												<section><h3>After edit</h3><pre>{log.new_text ?? "(Value removed)"}</pre></section>
											</div>
										</details>
									</td>
									<td>{log.target}</td>
								</tr>)}</tbody>
							</table></div> : <p>No database edits have been logged in the past 7 days.</p>}
							{hasMore && <button className="search-button logs-more" type="button" disabled={isLoading} onClick={() => void loadLogs(true)}>Load more logs</button>}
						</section>
					</>}
					</section>
				</div>
			</main>
		</Protected>
	);
}

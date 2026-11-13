import { useAuth } from "@clerk/react-router";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

type OrganizationData = {
	organization: null | {
		id: string;
		name: string;
		clerkOrganizationId: string | null;
		role: "student" | "mentor" | "kiosk";
		teams: { league: "FTC" | "FRC"; team_number: string }[];
		joinCode?: string;
		members?: { userId: string; name: string; email: string; role: "student" | "mentor" | "kiosk" }[];
	};
	isAdmin: boolean;
};

async function parseResponse<T>(response: Response) {
	const text = await response.text();
	try {
		return JSON.parse(text) as T & { error?: string };
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

export function OrganizationSettings() {
	const { getToken } = useAuth();
	const [data, setData] = useState<OrganizationData | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const token = await getToken();
			if (!token) throw new Error("Sign in to load organization settings.");
			const response = await fetch("/api/organizations", { headers: { Authorization: `Bearer ${token}` } });
			const result = await parseResponse<OrganizationData>(response);
			if (!response.ok) throw new Error(result.error || "Could not load organization settings.");
			setData(result);
			if (result.organization) {
				setName(result.organization.name);
			}
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "Could not load organization settings.");
		} finally {
			setLoading(false);
		}
	}, [getToken]);

	useEffect(() => { void load(); }, [load]);

	async function mutate(action: string, extra: Record<string, unknown> = {}) {
		setSaving(true);
		setError("");
		setNotice("");
		try {
			const token = await getToken();
			if (!token) throw new Error("Sign in to update organization settings.");
			const response = await fetch("/api/organizations", {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ action, ...extra }),
			});
			const result = await parseResponse<OrganizationData>(response);
			if (!response.ok) throw new Error(result.error || "Could not update organization settings.");
			setData(result);
			if (result.organization) {
				setName(result.organization.name);
			}
			setNotice(action === "rotate-code" ? "Join code refreshed." : "Organization name saved.");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not update organization settings.");
		} finally {
			setSaving(false);
		}
	}

	async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await mutate("save-name", { name });
	}

	async function memberAction(action: "set-role" | "remove-member", userId: string, role?: "student" | "mentor" | "kiosk") {
		await mutate(action, { userId, ...(role ? { role } : {}) });
	}

	if (loading) return <section className="organization-settings"><p className="logs-status" aria-busy="true">Loading organization settings...</p></section>;
	if (!data?.organization) return <section className="organization-settings">
		<p className="section-kicker">Organization</p>
		<h2>No organization yet</h2>
		{error && <p className="lookup-error" role="alert">{error}</p>}
		<p>Join with a mentor’s code or request access for a new team.</p>
		<Link to="/join">Join an organization</Link> · <Link to="/request-access">Request access</Link>
		{data?.isAdmin && <p><Link to="/admin">Open the organization admin panel</Link></p>}
	</section>;

	const organization = data.organization;
	const isMentor = organization.role === "mentor";
	const organizationMembers = organization.members || [];
	return <section className="organization-settings">
		<p className="section-kicker">Organization · {organization.role}</p>
		<h2>{organization.name}</h2>
		{error && <p className="lookup-error" role="alert">{error}</p>}
		{notice && <p className="settings-saved" role="status">{notice}</p>}
		{isMentor ? <>
			<div className="organization-code">
				<div><strong>Member join code</strong><code>{organization.joinCode}</code></div>
				<button type="button" disabled={saving} onClick={() => void mutate("rotate-code")}>Refresh code</button>
			</div>
			<form className="organization-settings-form" onSubmit={(event) => void saveSettings(event)}>
				<label>Organization name<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} required /></label>
				<button className="search-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save organization name"}</button>
			</form>
			<h3>Available teams</h3>
			<p className="organization-team-help">Only the site administrator can change the teams available to this organization. Members choose their own dashboard team in Personal Settings.</p>
			<ul className="organization-team-list">{organization.teams.map((team) => <li key={`${team.league}:${team.team_number}`}>
				<span>{team.league}</span><strong>{team.team_number}</strong>
			</li>)}</ul>
			<h3>Members · {organizationMembers.length} / 20</h3>
			{organizationMembers.length === 0 ? <p>No members yet.</p> : <ul className="organization-member-list">{organizationMembers.map((member) => <li key={member.userId}>
				<div className="organization-member-identity">
					<strong>{member.name}</strong>
					<span>{member.email}</span>
				</div>
				<label>Account type<select value={member.role} disabled={saving} onChange={(event) => void memberAction("set-role", member.userId, event.target.value as "student" | "mentor" | "kiosk")}>
					<option value="student">Student</option>
					<option value="mentor">Mentor</option>
					<option value="kiosk">Kiosk</option>
				</select></label>
				<button className="organization-remove-member" type="button" disabled={saving || member.userId === organizationMembers.find((item) => item.email.toLowerCase() === "kyelerw@icloud.com")?.userId} onClick={() => void memberAction("remove-member", member.userId)}>Remove member</button>
			</li>)}</ul>}
		</> : <>
			<p>{organization.role === "kiosk" ? "Kiosk accounts can scout and add notes. Organization membership is managed by mentors." : "Students can scout and add notes. Organization settings and membership are managed by mentors."}</p>
			<h3>Available teams</h3>
			<ul className="organization-team-list">{organization.teams.map((team) => <li key={`${team.league}:${team.team_number}`}>
				<span>{team.league}</span><strong>{team.team_number}</strong>
			</li>)}</ul>
		</>}
		{data.isAdmin && <p><Link to="/admin">Open the organization admin panel</Link></p>}
	</section>;
}

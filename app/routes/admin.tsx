import { useAuth } from "@clerk/react-router";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/admin";

type AdminData = {
	organizations: {
		id: string; name: string; clerk_organization_id: string | null; member_count: number;
		teams: { league: "FTC" | "FRC"; team_number: string }[];
	}[];
	requests: {
		id: string; name: string; organization_name: string; email: string; role: "student" | "mentor";
		message: string; team_numbers: string; status: "pending" | "accepted" | "rejected"; created_at: string;
	}[];
	whitelist: { email: string; organization_id: string; organization_name: string; role: "student" | "mentor" | "kiosk"; added_at: string }[];
	members: { userId: string; organizationId: string; organizationName: string; name: string; email: string; role: "student" | "mentor" | "kiosk" }[];
};
type OrganizationTeamInput = { FTC: string; FRC: string };

function teamInputFor(teams: AdminData["organizations"][number]["teams"]): OrganizationTeamInput {
	return {
		FTC: teams.filter((team) => team.league === "FTC").map((team) => team.team_number).join(", "),
		FRC: teams.filter((team) => team.league === "FRC").map((team) => team.team_number).join(", "),
	};
}

function formatRequestedTeams(value: string) {
	try {
		const teams = JSON.parse(value) as { league: "FTC" | "FRC"; teamNumber: string }[];
		return (["FTC", "FRC"] as const)
			.map((league) => `${league}: ${teams.filter((team) => team.league === league).map((team) => team.teamNumber).join(", ") || "none"}`)
			.join(" · ");
	} catch {
		return value;
	}
}

async function parseResponse<T>(response: Response) {
	const text = await response.text();
	try {
		return JSON.parse(text) as T & { error?: string };
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Organization admin | Scout 5837" }];
}

export default function AdminPage() {
	const { getToken } = useAuth();
	const [data, setData] = useState<AdminData | null>(null);
	const [organizationTeams, setOrganizationTeams] = useState<Record<string, OrganizationTeamInput>>({});
	const [email, setEmail] = useState("");
	const [organizationId, setOrganizationId] = useState("");
	const [role, setRole] = useState<"student" | "mentor" | "kiosk">("student");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const token = await getToken();
			if (!token) throw new Error("Sign in with the app administrator account.");
			const response = await fetch("/api/admin", { headers: { Authorization: `Bearer ${token}` } });
			const result = await parseResponse<AdminData>(response);
			if (!response.ok) throw new Error(result.error || "Could not load the organization admin panel.");
			setData(result);
			setOrganizationTeams(Object.fromEntries(result.organizations.map((organization) => [organization.id, teamInputFor(organization.teams)])));
			setOrganizationId((current) => current || result.organizations[0]?.id || "");
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : "Could not load the organization admin panel.");
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
			if (!token) throw new Error("Sign in with the app administrator account.");
			const response = await fetch("/api/admin", {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ action, ...extra }),
			});
			const result = await parseResponse<AdminData & { organization?: { memberCount: number; enrollmentFailureCount?: number } }>(response);
			if (!response.ok) throw new Error(result.error || "Could not update organization access.");
			if (result.organizations) {
				setData(result);
				setOrganizationTeams(Object.fromEntries(result.organizations.map((organization) => [organization.id, teamInputFor(organization.teams)])));
			}
			else if (action === "bootstrap-waterloo") await load();
			setNotice(action === "bootstrap-waterloo"
				? `Waterloo Robotics initialized. ${result.organization?.memberCount ?? 0} existing accounts synced; ${result.organization?.enrollmentFailureCount ?? 0} require manual Clerk review.`
				: "Organization access updated.");
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not update organization access.");
		} finally {
			setSaving(false);
		}
	}

	async function addWhitelist(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await mutate("whitelist", { email, organizationId, role });
		setEmail("");
	}

	async function saveOrganizationTeams(event: React.FormEvent<HTMLFormElement>, id: string) {
		event.preventDefault();
		const input = organizationTeams[id] || { FTC: "", FRC: "" };
		const teams: { league: "FTC" | "FRC"; teamNumber: string }[] = [];
		for (const league of ["FTC", "FRC"] as const) {
			const numbers = input[league].split(",").map((number) => number.trim()).filter(Boolean);
			if (numbers.some((number) => !/^\d{1,6}$/.test(number))) {
				setError(`Enter numeric ${league} team numbers separated by commas.`);
				return;
			}
			teams.push(...numbers.map((teamNumber) => ({ league, teamNumber })));
		}
		if (!teams.length || teams.length > 30) {
			setError("Enter between 1 and 30 team numbers for this organization.");
			return;
		}
		await mutate("save-organization-teams", { organizationId: id, teams });
	}

	const waterloo = data?.organizations.find((organization) => organization.id === "waterloo-robotics");
	return (
		<main className="organization-admin-page">
			<header>
				<p className="section-kicker">Scout 5837 · Administrator</p>
				<h1>Organization access</h1>
				<p>Manage team applications, approved email access, and organization members.</p>
			</header>
			<p><Link to="/home">Open Scout 5837</Link></p>
			{error && <p className="lookup-error" role="alert">{error}</p>}
			{notice && <p className="settings-saved" role="status">{notice}</p>}
			{loading && <p className="logs-status" aria-busy="true">Loading organization access...</p>}
			{!loading && data && <>
				{!waterloo?.clerk_organization_id && <section className="organization-admin-card">
					<h2>Initialize Waterloo Robotics</h2>
					<p>This one-time step creates the Clerk organization, adds the existing Clerk accounts, and makes kyelerw@icloud.com a mentor. Existing scouting notes have been assigned to Waterloo Robotics by the database migration.</p>
					<button className="search-button" disabled={saving} onClick={() => void mutate("bootstrap-waterloo")}>
						{saving ? "Initializing..." : "Initialize Waterloo Robotics"}
					</button>
				</section>}
				<section className="organization-admin-card">
					<h2>Organization team access</h2>
					<p>Set the team numbers members of each organization can select in their Personal Settings.</p>
					<div className="organization-team-admin-list">{data.organizations.map((organization) => {
						const teams = organizationTeams[organization.id] || teamInputFor(organization.teams);
						return <form className="organization-team-admin-item" key={organization.id} onSubmit={(event) => void saveOrganizationTeams(event, organization.id)}>
							<div className="organization-team-admin-heading">
								<div><h3>{organization.name}</h3><span>{organization.member_count} members</span></div>
								<button className="search-button" disabled={saving}>{saving ? "Saving..." : "Save teams"}</button>
							</div>
							<label>FTC team numbers<input inputMode="numeric" maxLength={300} placeholder="7247, 5445" value={teams.FTC}
								onChange={(event) => setOrganizationTeams((current) => ({ ...current, [organization.id]: { ...teams, FTC: event.target.value } }))} /></label>
							<label>FRC team numbers<input inputMode="numeric" maxLength={300} placeholder="5837" value={teams.FRC}
								onChange={(event) => setOrganizationTeams((current) => ({ ...current, [organization.id]: { ...teams, FRC: event.target.value } }))} /></label>
						</form>;
					})}</div>
				</section>
				<section className="organization-admin-card">
					<h2>Access requests</h2>
					{data.requests.filter((item) => item.status === "pending").length === 0
						? <p>No pending requests.</p>
						: data.requests.filter((item) => item.status === "pending").map((item) => {
							return <article className="organization-admin-item" key={item.id}>
								<div>
									<h3>{item.organization_name}</h3>
									<p>{item.name} · {item.email} · {item.role}</p>
									<p>{formatRequestedTeams(item.team_numbers)}</p>
									{item.message && <p>{item.message}</p>}
								</div>
								<div className="organization-admin-actions">
									<button disabled={saving} onClick={() => void mutate("accept-request", { requestId: item.id })}>Approve and create organization</button>
									<button disabled={saving} onClick={() => void mutate("reject-request", { requestId: item.id })}>Reject</button>
								</div>
							</article>;
						})}
				</section>
				<section className="organization-admin-card">
					<h2>Whitelist an email</h2>
					<p>Choose an organization and role. Existing accounts are enrolled immediately; new accounts are enrolled after sign-in.</p>
					<form className="organization-form organization-admin-form" onSubmit={(event) => void addWhitelist(event)}>
						<label>Email<input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
						<label>Organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
							{data.organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
						</select></label>
						<label>Account type<select value={role} onChange={(event) => setRole(event.target.value as "student" | "mentor" | "kiosk")}>
							<option value="student">Student</option>
							<option value="mentor">Mentor</option>
							<option value="kiosk">Kiosk</option>
						</select></label>
						<button className="search-button" disabled={saving || !organizationId}>Whitelist</button>
					</form>
					<ul className="organization-admin-list">{data.whitelist.map((entry) => <li key={entry.email}>
						<span>{entry.email} · {entry.organization_name} · {entry.role}</span>
						<button className="organization-remove-member" disabled={saving} onClick={() => void mutate("remove-whitelist", { email: entry.email })}>Remove access</button>
					</li>)}</ul>
				</section>
				<section className="organization-admin-card">
					<h2>Organization members</h2>
					{data.members.length === 0 ? <p>No organization members are enrolled yet.</p> : <ul className="organization-admin-list">
						{data.members.map((member) => <li key={`${member.organizationId}:${member.userId}`}>
							<div className="organization-admin-member-identity">
								<strong>{member.name}</strong>
								<span>{member.email} · {member.organizationName}</span>
							</div>
							<span className={`organization-role-badge organization-role-${member.role}`}>{member.role}</span>
							<button className="organization-remove-member" disabled={saving || member.email.toLowerCase() === "kyelerw@icloud.com"} onClick={() => void mutate("remove-member", { userId: member.userId, organizationId: member.organizationId })}>Remove member</button>
						</li>)}
					</ul>}
				</section>
			</>}
		</main>
	);
}

import { UserButton, useAuth } from "@clerk/react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/logs";
import { Protected } from "../protected";

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

async function parseResponse<T>(response: Response): Promise<T & { error?: string }> {
	const text = await response.text();
	try {
		return JSON.parse(text) as T & { error?: string };
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Debug Logs | Scout 5837" }, { name: "description", content: "Recent scouting database edits." }];
}

export default function LogsPage() {
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
	}, [getToken]);

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
				<nav className="topbar" aria-label="Main navigation">
					<a className="brand" href="/home"><span>Scout 5837</span></a>
					<div className="topbar-tabs" aria-label="Search mode">
						<a href="/home">Team search</a>
						<a href="/events">Event search</a>
						<a href="/logs" aria-current="page">Logs</a>
					</div>
					<UserButton />
				</nav>
				<div className="logs-page">
					<header className="logs-heading">
						<p className="section-kicker">Admin / Debug</p>
						<h1>Database edit requests</h1>
						<p>Database edits from the past 7 days. Older records are automatically deleted.</p>
					</header>
					{error && <p className="lookup-error" role="alert">{error}</p>}
					{isLoading && <p className="logs-status" aria-busy="true">Loading logs...</p>}
					{!isLoading && isAllowed === false && <section className="logs-denied" role="alert">
						<h2>Access not allowed</h2>
						<p>Your account can't access this debug page. Ask Kyeler Werkmeister to add your email or account name to the whitelist.</p>
					</section>}
					{!isLoading && isAllowed && <>
						{canManageWhitelist && <section className="logs-whitelist">
							<h2>Manage access</h2>
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
							<h2 id="logs-title">Recent database edits</h2>
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
				</div>
			</main>
		</Protected>
	);
}

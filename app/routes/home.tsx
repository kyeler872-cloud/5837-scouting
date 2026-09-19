import type { Route } from "./+types/home";
import { Show, UserButton, useAuth } from "@clerk/react";
import { useState } from "react";
import { Protected } from "../protected";

type JsonRecord = Record<string, unknown>;

type TeamLookupResponse = {
	teamNumber: string;
	season: string;
	team: JsonRecord | null;
	events: JsonRecord | JsonRecord[] | null;
	awards: JsonRecord | JsonRecord[] | null;
	matches: JsonRecord | JsonRecord[] | null;
	overrides: Record<string, { value: string; userId: string; displayName: string }>;
	selectedEvents: Record<string, { eventName: string; userId: string; displayName: string }>;
	warnings: string[];
	meta: { fetchedAt: string; source: string; editableFields: string[] };
};

function textValue(record: JsonRecord | null, keys: string[]) {
	if (!record) return null;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value;
		if (typeof value === "number") return String(value);
	}
	return null;
}

function records(value: JsonRecord | JsonRecord[] | null) {
	if (Array.isArray(value)) return value;
	if (!value) return [];
	for (const key of ["events", "awards", "matches", "data", "items"]) {
		if (Array.isArray(value[key])) return value[key] as JsonRecord[];
	}
	return [value];
}

function averageMatchScore(matches: JsonRecord | JsonRecord[] | null) {
	const scores = records(matches)
		.map((match) => {
			const value = match.score ?? match.totalScore ?? match.actualScore;
			return typeof value === "number" ? value : Number(value);
		})
		.filter((score) => Number.isFinite(score));
	if (!scores.length) return null;
	return (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1);
}

async function readResponse<T>(response: Response) {
	const body = await response.text();
	try {
		return JSON.parse(body) as T;
	} catch {
		throw new Error(body || `Request failed (${response.status}).`);
	}
}

function shownValue(result: TeamLookupResponse, field: string, record: JsonRecord | null, keys: string[]) {
	return result.overrides[field]?.value || textValue(record, keys) || "Unavailable";
}

const seasons = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "This is 5837" },
		{ name: "description", content: "5837 is the best!" },
	];
}

export default function Home() {
	const { getToken } = useAuth();
	const [teamNumber, setTeamNumber] = useState("");
	const [season, setSeason] = useState("2025");
	const [result, setResult] = useState<TeamLookupResponse | null>(null);
	const [error, setError] = useState("");
	const [isSearching, setIsSearching] = useState(false);

	async function searchTeam(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalizedTeamNumber = teamNumber.trim();
		if (!/^\d{1,6}$/.test(normalizedTeamNumber)) {
			setError("Enter a valid FTC team number.");
			return;
		}

		setError("");
		setResult(null);
		setIsSearching(true);
		try {
			const token = await getToken();
			const response = await fetch(`/api/teams/${normalizedTeamNumber}?season=${season}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			});
			const data = await readResponse<TeamLookupResponse | { error?: string }>(response);
			if (!response.ok) throw new Error("error" in data ? data.error : "Team lookup failed.");
			setResult(data as TeamLookupResponse);
		} catch (lookupError) {
			setError(lookupError instanceof Error ? lookupError.message : "Team lookup failed.");
		} finally {
			setIsSearching(false);
		}
	}

	async function saveOverride(field: string, value: string) {
		if (!result) return;
		const token = await getToken();
		const response = await fetch(`/api/teams/${result.teamNumber}?season=${result.season}`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({ field, value }),
		});
		const data = await readResponse<{ overrides?: TeamLookupResponse["overrides"]; error?: string }>(response);
		if (!response.ok) throw new Error(data.error || "Could not save edit.");
		setResult({ ...result, overrides: data.overrides || result.overrides });
	}

	async function selectEvent(eventCode: string, eventName: string, selected: boolean) {
		if (!result) return;
		const token = await getToken();
		const response = await fetch(`/api/teams/${result.teamNumber}?season=${result.season}`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify({ field: "eventSelection", eventCode, eventName, selected }),
		});
		const data = await readResponse<{ selectedEvents?: TeamLookupResponse["selectedEvents"]; error?: string }>(response);
		if (!response.ok) throw new Error(data.error || "Could not update event.");
		setResult({ ...result, selectedEvents: data.selectedEvents || result.selectedEvents });
	}

	return (
		<Protected>
			<main className="home-shell">
				<nav className="topbar" aria-label="Main navigation">
					<a className="brand" href="/home">
						<span>Scout 5837</span>
					</a>
					<Show when="signed-in">
						<UserButton />
					</Show>
				</nav>
				<section className="scouting-search" aria-labelledby="scouting-title">
					<p className="section-kicker">FIRST Tech Challenge</p>
					<h1 id="scouting-title">search for a team!</h1>
					<p className="search-intro">Search the FIRST API for a team profile, events, awards, and performance data.</p>
					<form className="team-search" onSubmit={searchTeam}>
						<div className="search-options">
							<div><label htmlFor="team-number">FTC team number</label><input id="team-number" inputMode="numeric" pattern="[0-9]*" placeholder="5837" value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} /></div>
							<div><label htmlFor="season">FTC season</label><select id="season" value={season} onChange={(event) => setSeason(event.target.value)}>{seasons.map((year) => <option key={year} value={year}>{year}-{String(year + 1).slice(-2)}</option>)}</select></div>
						</div>
						<div className="search-row">
							<button className="search-button" type="submit" disabled={isSearching}>{isSearching ? "Searching..." : "Search"}</button>
						</div>
					</form>
					{error && <p className="lookup-error" role="alert">{error}</p>}
				</section>
				{result && (
					<section className="team-results" aria-live="polite">
						<header className="team-heading">
							<div>
								<p className="section-kicker">Team {result.teamNumber} / {result.season} season</p>
								<SourceMark /><EditableValue field="name" value={shownValue(result, "name", result.team, ["nameLong", "nameShort", "name"])} attribution={result.overrides.name?.displayName} onSave={saveOverride} heading />
								<SourceMark /><EditableValue field="location" value={result.overrides.location?.value || [textValue(result.team, ["city"]), textValue(result.team, ["state"]), textValue(result.team, ["country"])].filter(Boolean).join(", ") || "Unavailable"} attribution={result.overrides.location?.displayName} onSave={saveOverride} />
							</div>
							{(() => { const logo = textValue(result.team, ["logo", "logoUrl", "teamLogo"]); return logo ? <img className="team-logo" src={logo} alt="Team logo" /> : null; })()}
						</header>
						<div className="team-facts">
							<div><span>Rookie year</span><SourceMark /><EditableValue field="rookieYear" value={shownValue(result, "rookieYear", result.team, ["rookieYear"])} attribution={result.overrides.rookieYear?.displayName} onSave={saveOverride} /></div>
							<div><span>Events</span><SourceMark /><strong>{records(result.events).length || "None listed"}</strong></div>
							<div><span>Awards</span><SourceMark /><strong>{records(result.awards).length || "None listed"}</strong></div>
							<div><span>Average score</span><SourceMark /><strong>{averageMatchScore(result.matches) || "Unavailable"}</strong></div>
						</div>
						<div className="custom-notes"><span>Shared scouting notes</span><EditableValue field="notes" value={result.overrides.notes?.value || "Add a note"} attribution={result.overrides.notes?.displayName} onSave={saveOverride} /></div>
						<div className="result-columns">
							<EventList items={records(result.events)} selectedEvents={result.selectedEvents} onSelect={selectEvent} />
							<ResultList title="Awards" items={records(result.awards)} primaryKeys={["name", "awardName", "eventName"]} firstSource />
						</div>
						{result.warnings.length > 0 && <p className="lookup-warning">Some FIRST data was unavailable: {result.warnings.join("; ")}</p>}
					</section>
				)}
			</main>
		</Protected>
	);
}

function SourceMark() {
	return <img className="first-mark" src="https://www.firstinspires.org/sites/default/files/uploads/resource_library/brand/first-logo.png" alt="From FIRST" title="Data from FIRST" />;
}

function ResultList({ title, items, primaryKeys, firstSource = false }: { title: string; items: JsonRecord[]; primaryKeys: string[]; firstSource?: boolean }) {
	return (
		<section className="result-list">
			<h3>{firstSource && <SourceMark />}{title}</h3>
			{items.length ? items.slice(0, 12).map((item, index) => <p key={`${title}-${index}`}>{firstSource && <SourceMark />}{textValue(item, primaryKeys) || "Record available"}</p>) : <p className="muted">No records returned.</p>}
		</section>
	);
}

function EventList({ items, selectedEvents, onSelect }: { items: JsonRecord[]; selectedEvents: TeamLookupResponse["selectedEvents"]; onSelect: (code: string, name: string, selected: boolean) => Promise<void> }) {
	return <section className="result-list"><h3><SourceMark />Events</h3>{items.length ? items.slice(0, 12).map((item, index) => {
		const code = textValue(item, ["code", "eventCode"]) || `event-${index}`;
		const name = textValue(item, ["name", "eventName", "code"]) || "Event";
		return <label className="event-row" key={code}><SourceMark /><span>{name}</span><input type="checkbox" checked={Boolean(selectedEvents[code])} onChange={(event) => void onSelect(code, name, event.target.checked)} title="Add this FIRST event to shared scouting data" />{selectedEvents[code] && <span className="attribution">added by {selectedEvents[code].displayName}</span>}</label>;
	}) : <p className="muted">No records returned.</p>}</section>;
}

function EditableValue({ field, value, attribution, onSave, heading = false }: { field: string; value: string; attribution?: string; onSave: (field: string, value: string) => Promise<void>; heading?: boolean }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value === "Unavailable" || value === "Add a note" ? "" : value);
	const [saving, setSaving] = useState(false);

	async function commit() {
		setSaving(true);
		try { await onSave(field, draft); setEditing(false); } catch { /* keep the editor open for another attempt */ } finally { setSaving(false); }
	}

	if (editing) return <span className="editable-editor"><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void commit(); if (event.key === "Escape") setEditing(false); }} /><button type="button" onClick={() => void commit()} disabled={saving}>Save</button></span>;
	return <button type="button" className={`editable-value${heading ? " editable-heading" : ""}`} onClick={() => { setDraft(value === "Unavailable" || value === "Add a note" ? "" : value); setEditing(true); }} title="Edit shared value"><span>{value}</span>{attribution && <small className="attribution">custom by {attribution}</small>}<small aria-hidden="true">Edit</small></button>;
}

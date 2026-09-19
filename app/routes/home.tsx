// imports for routing, clerk auth, react state, and our protected page wrapper
import type { Route } from "./+types/home";
import { Show, UserButton, useAuth, useUser, useOrganization } from "@clerk/react";
import { useState } from "react";
import { Protected } from "../protected";

// quick type definition for generic json objects from api
type JsonRecord = Record<string, unknown>;

// type setup so typescript knows what the team search api response looks like
type TeamLookupResponse = {
    teamNumber: string;
    season: string;
    team: JsonRecord | null;
    events: JsonRecord | JsonRecord[] | null;
    awards: JsonRecord | JsonRecord[] | null;
    matches: JsonRecord | JsonRecord[] | null;
    overrides: Record<string, { value: string; displayName: string }>;
    selectedEvents: Record<string, { eventName: string; displayName: string }>;
    customEvents: { code: string; name: string; date: string | null; displayName: string }[];
    ftcScout: { available: boolean; warning: string | null; scores: { auto: number | null; teleop: number | null; endgame: number | null; total: number | null; penalties: number | null; winRate: number | null } };
    warnings: string[];
    meta: { fetchedAt: string; source: string; editableFields: string[] };
};

// helper to grab a text or number string out of a json object using a list of key names
function textValue(record: JsonRecord | null, keys: string[]) {
    if (!record) return null;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value;
        if (typeof value === "number") return String(value);
    }
    return null;
}

// turns whatever the api gave into a clean array so we can map over it easily
function records(value: JsonRecord | JsonRecord[] | null) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    for (const key of ["events", "awards", "matches", "data", "items"]) {
        if (Array.isArray(value[key])) return value[key] as JsonRecord[];
    }
    return [value];
}

// calculates the average score from match data and rounds to 1 decimal place
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

// helper to parse api fetch responses into json or throw an error message
async function readResponse<T>(response: Response) {
    const body = await response.text();
    try {
        return JSON.parse(body) as T;
    } catch {
        throw new Error(body || `Request failed (${response.status}).`);
    }
}

// picks user override value if one exists, otherwise falls back to api data or "unavailable"
function shownValue(result: TeamLookupResponse, field: string, record: JsonRecord | null, keys: string[]) {
    return result.overrides[field]?.value || textValue(record, keys) || "Unavailable";
}

// converts yyyy-mm-dd dates into mm/dd/yyyy format
function formatEventDate(date: string) {
    const [year, month, day] = date.slice(0, 10).split("-");
    return `${month}/${day}/${year}`;
}

// formats start and end dates for an event into a single string
function firstEventDate(event: JsonRecord) {
    const start = textValue(event, ["dateStart"]);
    const end = textValue(event, ["dateEnd"]);
    if (!start && !end) return "Date unavailable";
    if (!end || end === start) return formatEventDate(start || end || "");
    return `${formatEventDate(start || end || "")} - ${formatEventDate(end)}`;
}

// seasonies 
const seasons = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

// page title and metadata for the browser tab
export function meta({}: Route.MetaArgs) {
    return [
        { title: "This is 5837" },
        { name: "description", content: "5837 is the best!" },
    ];
}

// main homepage component that holds state and renders everything
export default function Home() {
    // clerk auth hook to grab auth token for api calls
    const { getToken } = useAuth();
    // react state hooks for tracking search inputs, team data results, errors, and loading state
    const [teamNumber, setTeamNumber] = useState("");
    const [season, setSeason] = useState("2025");
    const [result, setResult] = useState<TeamLookupResponse | null>(null);
    const [error, setError] = useState("");
    const [isSearching, setIsSearching] = useState(false);

    // handles search form submission and fetches team data from backend
    async function searchTeam(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedTeamNumber = teamNumber.trim();
        // check if team number is valid 1-6 digits
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

    // sends put request to save custom notes or overrides to database
    async function saveOverride(field: string, value: string) {
        try {
            if (!result) return;
            const token = await getToken();
            const response = await fetch(`/api/teams/${result.teamNumber}?season=${result.season}`, { method: "PUT", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ field, value }) });
            const data = await readResponse<{ overrides?: TeamLookupResponse["overrides"]; error?: string }>(response);
            if (!response.ok) throw new Error(data.error || "Could not save edit.");
            setResult({ ...result, overrides: data.overrides || result.overrides });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Could not save edit.");
            throw saveError;
        }
    }

    // sends put request to create a custom user event
    async function createEvent(eventName: string, eventDate: string) {
        if (!result) return;
        const token = await getToken();
        const response = await fetch(`/api/teams/${result.teamNumber}?season=${result.season}`, {
            method: "PUT",
            headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ field: "customEvent", eventName, eventDate: eventDate || null }),
        });
        try {
            const data = await readResponse<{ customEvents?: TeamLookupResponse["customEvents"]; error?: string }>(response);
            if (!response.ok) throw new Error(data.error || "Could not create event.");
            setResult({ ...result, customEvents: data.customEvents || result.customEvents });
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Could not create event.");
            throw createError; // we hate errors
        }
    }

    // renders the page UI inside protected auth wrapper
    return (
        <Protected>
            <main className="home-shell">
                {/* top bar with site logo and profile button */}
                <nav className="topbar" aria-label="Main navigation">
                    <a className="brand" href="/home">
                        <span>Scout 5837</span>
                    </a>
                    <Show when="signed-in">
                        <div style={{ display: "flex", alignItems: "center" }}>
                            <UserBadge />
                            <UserButton />
                        </div>
                    </Show>
                </nav>
                {/* team search form section */}
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
                {/* only shows search results if team data was found */}
                {result && (
                    <section className="team-results" aria-live="polite">
                        {/* team heading with name, location, logo */}
                        <header className="team-heading">
                            <div>
                                <p className="section-kicker">Team {result.teamNumber} / {result.season} season</p>
                                <h2>{textValue(result.team, ["nameLong", "nameShort", "name"]) || `Team ${result.teamNumber}`}</h2>
                                <p>{[textValue(result.team, ["city"]), textValue(result.team, ["state"]), textValue(result.team, ["country"])].filter(Boolean).join(", ") || "Location unavailable"}</p>
                            </div>
                            {(() => { const logo = textValue(result.team, ["logo", "logoUrl", "teamLogo"]); return logo ? <img className="team-logo" src={logo} alt="Team logo" /> : null; })()}
                        </header>
                        {/* summary stats section */}
                        <div className="team-facts">
                            <div><span>Rookie year</span><strong>{textValue(result.team, ["rookieYear"]) || "Unavailable"}</strong></div>
                            <div><span>Events</span><SourceMark /><strong>{records(result.events).length || "None listed"}</strong></div>
                            <div><span>Awards</span><SourceMark /><strong>{records(result.awards).length || "None listed"}</strong></div>
                            <div><span>Average score</span><SourceMark /><strong>{averageMatchScore(result.matches) || "Unavailable"}</strong></div>
                        </div>
                        {/* inline editable shared scouting notes */}
                        <div className="custom-notes"><span>Shared scouting notes</span><EditableValue field="notes" value={result.overrides.notes?.value || "Add a note"} attribution={result.overrides.notes?.displayName} onSave={saveOverride} /></div>
                        {/* detailed scores breakdown panel */}
                        <ScoresPanel scores={result.ftcScout.scores} available={result.ftcScout.available} warning={result.ftcScout.warning} />
                        {/* list of events and awards */}
                        <div className="result-columns">
                            <details className="events-awards" open>
                                <summary>Events and awards</summary>
                                <div className="result-columns"><EventList items={records(result.events)} customEvents={result.customEvents} onCreate={createEvent} /><ResultList title="Awards" items={records(result.awards)} primaryKeys={["name", "awardName", "eventName"]} /></div>
                            </details>
                        </div>
                        {result.warnings.length > 0 && <p className="lookup-warning">Some FIRST data was unavailable: {result.warnings.join("; ")}</p>}
                    </section>
                )}
            </main>
        </Protected>
    );
}

// renders [First L. · Role] using Clerk user & org data
function UserBadge() {
    const { user } = useUser();
    const { membership } = useOrganization();

    if (!user) return null;

    const firstName = user.firstName ?? "";
    const lastInitial = user.lastName ? `${user.lastName[0]}.` : "";
    const formattedName = `${firstName} ${lastInitial}`.trim() || user.username || "User";

    const rawRole = membership?.role ?? "Member";
    const cleanRole = rawRole.replace(/^org:/, "");
    const formattedRole = cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1);

    return (
        <span className="user-badge" style={{ marginRight: "0.75rem", fontWeight: 500 }}>
            {formattedName} · {formattedRole}
        </span>
    );
}

// renders ftcscout scores in a grid layout
function ScoresPanel({ scores, available, warning }: { scores: TeamLookupResponse["ftcScout"]["scores"]; available: boolean; warning: string | null }) {
    const fields: [string, number | string | null][] = [["Auto", scores.auto], ["Teleop", scores.teleop], ["Endgame", scores.endgame], ["Total", scores.total], ["Penalties", scores.penalties], ["Win rate", scores.winRate === null ? null : `${scores.winRate}%`]];
    return <section className="scores-panel"><div className="panel-heading"><div><p className="section-kicker">FTCScout</p><h3>Scores</h3></div><span className="data-status">{available ? "Live data" : "Placeholder"}</span></div><div className="score-grid">{fields.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value === null ? "Not available yet" : value}</strong></div>)}</div>{warning && <p className="lookup-warning">{warning}</p>}</section>;
}

// little icon component to mark official first data
function SourceMark() {
    return <img className="first-mark" src="/first.png" alt="From FIRST" title="Data from FIRST" />;
}

// generic list component to render lists like awards
function ResultList({ title, items, primaryKeys, firstSource = false }: { title: string; items: JsonRecord[]; primaryKeys: string[]; firstSource?: boolean }) {
    return (
        <section className="result-list">
            <h3>{firstSource && <SourceMark />}{title}</h3>
            {items.length ? items.slice(0, 12).map((item, index) => <p key={`${title}-${index}`}>{firstSource && <SourceMark />}{textValue(item, primaryKeys) || "Record available"}</p>) : <p className="muted">No records returned.</p>}
        </section>
    );
}

// renders event lists and form to create custom events
function EventList({ items, customEvents, onCreate }: { items: JsonRecord[]; customEvents: TeamLookupResponse["customEvents"]; onCreate: (name: string, date: string) => Promise<void> }) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [date, setDate] = useState("");
    return <section className="result-list"><h3><SourceMark />Events <button className="event-add-button" type="button" onClick={() => setCreating(!creating)} aria-expanded={creating} title="Create a new event">+</button></h3>
        {creating && <form className="new-event-form" onSubmit={(event) => { event.preventDefault(); void onCreate(name, date).then(() => { setName(""); setDate(""); setCreating(false); }); }}><input aria-label="Event name" placeholder="New event name" value={name} onChange={(event) => setName(event.target.value)} /><input aria-label="Event date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="submit">Create</button></form>}
        {items.length ? items.slice(0, 12).map((item, index) => <p className="event-row" key={`first-${index}`}><SourceMark /><span>{textValue(item, ["name", "eventName", "code"]) || "Event"}</span><strong className="custom-event-date">{firstEventDate(item)}</strong></p>) : <p className="muted">No FIRST events returned.</p>}
        {customEvents.map((event) => <p className="event-row custom-event" key={event.code}><span>{event.name}</span><strong className="custom-event-date">{event.date ? formatEventDate(event.date) : "Date unavailable"}</strong><span className="attribution">{event.displayName}</span></p>)}
    </section>;
}

// inline edit component that turns text into an input box on click
function EditableValue({ field, value, attribution, onSave, heading = false }: { field: string; value: string; attribution?: string; onSave: (field: string, value: string) => Promise<void>; heading?: boolean }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value === "Unavailable" || value === "Add a note" ? "" : value);
    const [saving, setSaving] = useState(false);

    async function commit() {
        setSaving(true);
        try { await onSave(field, draft); setEditing(false); } catch { /* keep the editor open for another attempt */ } finally { setSaving(false); }
    }

    if (editing) return <span className="editable-editor"><input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void commit(); if (event.key === "Escape") setEditing(false); }} /><button type="button" onClick={() => void commit()} disabled={saving}>Save</button></span>;
    return <button type="button" className={`editable-value${heading ? " editable-heading" : ""}`} onClick={() => { setDraft(value === "Unavailable" || value === "Add a note" ? "" : value); setEditing(true); }} title="Edit shared value"><span>{value}</span>{attribution && <small className="attribution">{attribution}</small>}<small aria-hidden="true">Edit</small></button>;
}
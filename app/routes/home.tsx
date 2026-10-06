// imports for routing, clerk auth, react state, and our protected page wrapper
import type { Route } from "./+types/home";
import { UserButton, useAuth, useUser, useOrganization } from "@clerk/react-router";
import { useEffect, useRef, useState } from "react";
import { Protected } from "../protected";

// quick type definition for generic json objects from api
type JsonRecord = Record<string, unknown>;

// type setup so typescript knows what the team search api response looks like
type TeamLookupResponse = {
    league: "FTC" | "FRC";
    teamNumber: string;
    season: string;
    team: JsonRecord | null;
    events: JsonRecord | JsonRecord[] | null;
    awards: JsonRecord | JsonRecord[] | null;
    matches: JsonRecord | JsonRecord[] | null;
    overrides: Record<string, { value: string; displayName: string }>;
    selectedEvents: Record<string, { eventName: string; displayName: string }>;
    customEvents: { code: string; name: string; date: string | null; displayName: string }[];
    performance: { auto: { average: string | null; matchCount: number }; teleop: { average: string | null; matchCount: number } };
    robots: RobotEntry[];
    warnings: string[];
    meta: { fetchedAt: string; source: string; editableFields: string[] };
};

type RobotEntry = {
    id: string;
    name: string;
    description: string;
    imageUrls: RobotImage[];
    startMonth: string;
    endMonth: string | null;
};

type RobotImage = {
    id: string;
    url: string;
    addedBy: string | null;
    displayName: string;
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
    const start = textValue(event, ["dateStart", "start_date"]);
    const end = textValue(event, ["dateEnd", "end_date"]);
    if (!start && !end) return "Date unavailable";
    if (!end || end === start) return formatEventDate(start || end || "");
    return `${formatEventDate(start || end || "")} - ${formatEventDate(end)}`;
}

const ftcSeasons = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
const frcSeasons = Array.from({ length: 2026 - 1992 + 1 }, (_, index) => 2026 - index);

function teamApiUrl(teamNumber: string, season: string, league: "FTC" | "FRC") {
    const search = new URLSearchParams({ season, league: league.toLowerCase() });
    return `/api/teams/${encodeURIComponent(teamNumber)}?${search}`;
}

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
    const [league, setLeague] = useState<"FTC" | "FRC">("FTC");
    const [season, setSeason] = useState("2025");
    const [result, setResult] = useState<TeamLookupResponse | null>(null);
    const [error, setError] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [activeSection, setActiveSection] = useState("auto");

    useEffect(() => {
        if (!result) return;
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0];
            if (visible) setActiveSection(visible.target.id);
        }, { rootMargin: "-15% 0px -70% 0px", threshold: 0 });
        const sections = ["auto", "teleop", "events", "robot"]
            .map((id) => document.getElementById(id))
            .filter((section): section is HTMLElement => section !== null);
        sections.forEach((section) => observer.observe(section));
        return () => observer.disconnect();
    }, [result]);

    // handles search form submission and fetches team data from backend
    async function searchTeam(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedTeamNumber = teamNumber.trim();
        // check if team number is valid 1-6 digits
        if (!/^\d{1,6}$/.test(normalizedTeamNumber)) {
            setError(`Enter a valid ${league} team number.`);
            return;
        }

        setError("");
        setResult(null);
        setActiveSection("auto");
        setIsSearching(true);
        try {
            const token = await getToken();
            const response = await fetch(teamApiUrl(normalizedTeamNumber, season, league), {
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
            const response = await fetch(teamApiUrl(result.teamNumber, result.season, result.league), { method: "PUT", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ field, value }) });
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
        const response = await fetch(teamApiUrl(result.teamNumber, result.season, result.league), {
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

    async function saveRobot(robot: Omit<RobotEntry, "id">, robotId?: string) {
        if (!result) return;
        try {
            const token = await getToken();
            const response = await fetch(teamApiUrl(result.teamNumber, result.season, result.league), {
                method: "PUT",
                headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                    field: "robot",
                    robotId,
                    robotName: robot.name,
                    description: robot.description,
                    imageUrls: robot.imageUrls.map(({ id, url }) => ({ id, url })),
                    startMonth: robot.startMonth,
                    endMonth: robot.endMonth,
                }),
            });
            const data = await readResponse<{ robots?: RobotEntry[]; error?: string }>(response);
            if (!response.ok) throw new Error(data.error || "Could not save robot.");
            setResult({ ...result, robots: data.robots || result.robots });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Could not save robot.");
            throw saveError;
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
                    <div style={{ display: "flex", alignItems: "center" }}>
                        <UserBadge />
                        <UserButton />
                    </div>
                </nav>
                {/* team search form section */}
                <section className="scouting-search" aria-labelledby="scouting-title">
                    <p className="section-kicker">FIRST Robotics Scouting</p>
                    <h1 id="scouting-title">search for a team!</h1>
                    <p className="search-intro">Search team profiles, event history, awards, and match performance.</p>
                    <form className="team-search" onSubmit={searchTeam}>
                        <div className="search-options">
                            <div><label htmlFor="league">Program</label><select id="league" value={league} onChange={(event) => setLeague(event.target.value as "FTC" | "FRC")}>
                                <option value="FTC">FTC</option>
                                <option value="FRC">FRC</option>
                            </select></div>
                            <div><label htmlFor="season">Season</label><select id="season" value={season} onChange={(event) => setSeason(event.target.value)}>{(league === "FTC" ? ftcSeasons : frcSeasons).map((year) => <option key={year} value={year}>{year}-{String(year + 1).slice(-2)}</option>)}</select></div>
                        </div>
                        <div className="team-number-field"><label htmlFor="team-number">{league} team number</label><input id="team-number" inputMode="numeric" pattern="[0-9]*" placeholder={league === "FTC" ? "7247" : "5837"} value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} /></div>
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
                                <p className="section-kicker">{result.league} team {result.teamNumber} / {result.season} season</p>
                                <h2>{textValue(result.team, ["nameLong", "nameShort", "nickname", "name"]) || `Team ${result.teamNumber}`}</h2>
                                <p>{[textValue(result.team, ["city"]), textValue(result.team, ["state", "state_prov"]), textValue(result.team, ["country"])].filter(Boolean).join(", ") || "Location unavailable"}</p>
                            </div>
                            {(() => { const logo = textValue(result.team, ["logo", "logoUrl", "teamLogo"]); return logo ? <img className="team-logo" src={logo} alt="Team logo" /> : null; })()}
                        </header>
                        <div className="team-facts">
                            <div><span>Rookie year</span><strong>{textValue(result.team, ["rookieYear", "rookie_year"]) || "Unavailable"}</strong></div>
                            <div><span>Events</span><SourceMark league={result.league} /><strong>{records(result.events).length || "None listed"}</strong></div>
                            <div><span>Awards</span><SourceMark league={result.league} /><strong>{records(result.awards).length || "None listed"}</strong></div>
                        </div>
                        <div className="team-sections-layout">
                            <aside className="section-sidebar" aria-label="Team page sections">
                                <p>On this page</p>
                                <nav>
                                    {(["auto", "teleop", "events", "robot"] as const).map((id) => (
                                        <button
                                            type="button"
                                            key={id}
                                            className={activeSection === id ? "active" : ""}
                                            aria-current={activeSection === id ? "location" : undefined}
                                            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                                        >
                                            {id === "teleop" ? "TeleOp" : id === "auto" ? "Auto" : id[0].toUpperCase() + id.slice(1)}
                                        </button>
                                    ))}
                                </nav>
                            </aside>
                            <div className="team-sections">
                                <PerformanceSection
                                    id="auto"
                                    title="Auto"
                                    description={`Average autonomous points per match from ${result.league === "FTC" ? "FIRST" : "The Blue Alliance"} event results.`}
                                    score={result.performance.auto.average}
                                    matchCount={result.performance.auto.matchCount}
                                    league={result.league}
                                    note={result.overrides.autoNotes}
                                    onSave={saveOverride}
                                />
                                <PerformanceSection
                                    id="teleop"
                                    title="TeleOp"
                                    description={`Average teleoperated points per match from ${result.league === "FTC" ? "FIRST" : "The Blue Alliance"} event results.`}
                                    score={result.performance.teleop.average}
                                    matchCount={result.performance.teleop.matchCount}
                                    league={result.league}
                                    note={result.overrides.teleopNotes}
                                    onSave={saveOverride}
                                />
                                <section className="team-section" id="events">
                                    <SectionHeading eyebrow="Competition record" title="Events" />
                                    <details className="events-awards" open>
                                        <summary>Events and awards</summary>
                                        <div className="result-columns">
                                            <EventList league={result.league} items={records(result.events)} customEvents={result.customEvents} onCreate={createEvent} />
                                            <ResultList league={result.league} title="Awards" items={records(result.awards)} primaryKeys={["name", "awardName", "eventName"]} />
                                        </div>
                                    </details>
                                </section>
                                <section className="team-section" id="robot">
                                    <SectionHeading eyebrow="Build history" title="Robot" />
                                    <RobotSection robots={result.robots} onSave={saveRobot} />
                                </section>
                            </div>
                        </div>
                        {result.league === "FRC" && <p className="data-attribution">FRC data powered by <a href="https://www.thebluealliance.com" target="_blank" rel="noreferrer">The Blue Alliance</a>.</p>}
                        {result.warnings.length > 0 && <p className="lookup-warning">Some {result.league} data was unavailable: {result.warnings.join("; ")}</p>}
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

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
    return <header className="team-section-heading"><p className="section-kicker">{eyebrow}</p><h3>{title}</h3></header>;
}

function PerformanceSection({ id, title, description, score, matchCount, league, note, onSave }: {
    id: string;
    title: string;
    description: string;
    score: string | null;
    matchCount: number;
    league: "FTC" | "FRC";
    note?: { value: string; displayName: string };
    onSave: (field: string, value: string) => Promise<void>;
}) {
    const field = id === "auto" ? "autoNotes" : "teleopNotes";
    return (
        <section className="team-section performance-section" id={id}>
            <SectionHeading eyebrow="FIRST match data" title={title} />
            <div className="performance-card">
                <div className="performance-score"><span>Average points per match</span><strong>{score ?? "—"}</strong></div>
                <p><SourceMark league={league} />{matchCount ? `Based on ${matchCount} scored ${matchCount === 1 ? "match" : "matches"}.` : "No scored matches were returned for this team."}</p>
            </div>
            <div className="custom-notes">
                <span>{title} notes</span>
                <p className="section-description">{description}</p>
                <EditableValue field={field} value={note?.value || "Add a note"} attribution={note?.displayName} onSave={onSave} />
            </div>
        </section>
    );
}

function RobotSection({ robots, onSave }: {
    robots: RobotEntry[];
    onSave: (robot: Omit<RobotEntry, "id">, robotId?: string) => Promise<void>;
}) {
    const [creating, setCreating] = useState(false);
    const [editingRobot, setEditingRobot] = useState<RobotEntry | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [startMonth, setStartMonth] = useState("");
    const [endMonth, setEndMonth] = useState("");
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const currentRobots = robots.filter((robot) => !robot.endMonth);
    const obsoleteRobots = robots.filter((robot) => Boolean(robot.endMonth));

    function openCreateForm() {
        setEditingRobot(null);
        setName("");
        setDescription("");
        setStartMonth("");
        setEndMonth("");
        setFormError("");
        setCreating(true);
    }

    function openEditForm(robot: RobotEntry) {
        setEditingRobot(robot);
    }

    function closeCreateForm() {
        setCreating(false);
        setFormError("");
    }

    async function submitRobot(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setFormError("");
        try {
            await onSave({
                name,
                description,
                imageUrls: [],
                startMonth,
                endMonth: endMonth || null,
            });
            setName("");
            setDescription("");
            setStartMonth("");
            setEndMonth("");
            setCreating(false);
        } catch (saveError) {
            setFormError(saveError instanceof Error ? saveError.message : "Could not save robot.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="robot-section-content">
            <p className="section-description">This team's past robot designs (This data is manually added):</p>
            {currentRobots.length > 0
                ? <div className="robot-grid">{currentRobots.map((robot) => <RobotCard key={robot.id} robot={robot} editing={editingRobot?.id === robot.id} onEdit={openEditForm} onSave={onSave} onCancel={() => setEditingRobot(null)} />)}</div>
                : <div className="empty-robots"><span>Robot history starts here</span><p>Add the current robot, its build dates, description, and photos.</p></div>}
            {obsoleteRobots.length > 0 && (
                <details className="obsolete-robots">
                    <summary>Show previous robots <span>{obsoleteRobots.length}</span></summary>
                    <div className="robot-grid">{obsoleteRobots.map((robot) => <RobotCard key={robot.id} robot={robot} editing={editingRobot?.id === robot.id} onEdit={openEditForm} onSave={onSave} onCancel={() => setEditingRobot(null)} />)}</div>
                </details>
            )}
            {!creating && <button className="add-robot-button" type="button" onClick={openCreateForm}>＋ Add another robot</button>}
            {creating && (
                <form className="robot-form" onSubmit={(event) => void submitRobot(event)}>
                    <h4>Add a robot</h4>
                    <div className="robot-form-fields">
                        <label>Robot name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Atlas" /></label>
                        <label>Start month<input required type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} /></label>
                        <label>End month <span>(leave blank if current)</span><input type="month" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} /></label>
                    </div>
                    <label>Description<textarea maxLength={2000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What makes this robot unique?" /></label>
                    {formError && <p className="lookup-error" role="alert">{formError}</p>}
                    <div className="robot-form-actions">
                        <button className="search-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save robot"}</button>
                        <button className="robot-cancel-button" type="button" onClick={closeCreateForm} disabled={saving}>Cancel</button>
                    </div>
                </form>
            )}
        </div>
    );
}

function RobotCard({ robot, editing, onEdit, onSave, onCancel }: {
    robot: RobotEntry;
    editing: boolean;
    onEdit: (robot: RobotEntry) => void;
    onSave: (robot: Omit<RobotEntry, "id">, robotId?: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [fullscreenPhoto, setFullscreenPhoto] = useState<{ photo: RobotImage; alt: string } | null>(null);
    const [photoError, setPhotoError] = useState("");
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const [name, setName] = useState(robot.name);
    const [description, setDescription] = useState(robot.description);
    const [startMonth, setStartMonth] = useState(robot.startMonth);
    const [endMonth, setEndMonth] = useState(robot.endMonth || "");
    const [images, setImages] = useState(robot.imageUrls);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        setName(robot.name);
        setDescription(robot.description);
        setStartMonth(robot.startMonth);
        setEndMonth(robot.endMonth || "");
        setImages(robot.imageUrls);
        setFormError("");
        setPhotoError("");
    }, [editing, robot.id, robot.imageUrls]);

    useEffect(() => {
        if (!fullscreenPhoto) return;
        const previousOverflow = document.body.style.overflow;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.style.overflow = "hidden";
        closeButtonRef.current?.focus();
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") setFullscreenPhoto(null);
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [fullscreenPhoto]);

    async function saveMetadata(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setFormError("");
        try {
            await onSave({ name, description, imageUrls: images, startMonth, endMonth: endMonth || null }, robot.id);
            onCancel();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Could not save robot.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <article className="robot-card">
            <div className="robot-card-heading">
                <div><h4>{robot.name}</h4><p>{formatMonth(robot.startMonth)} – {robot.endMonth ? formatMonth(robot.endMonth) : "Present"}</p></div>
                <div className="robot-card-actions">
                    {!robot.endMonth && <span className="current-robot-badge">Current</span>}
                    {!editing && <button className="edit-robot-button" type="button" onClick={() => onEdit(robot)} aria-label={`Edit ${robot.name}`}>Edit</button>}
                </div>
            </div>
            {editing ? (
                <form className="robot-edit-form" onSubmit={(event) => void saveMetadata(event)}>
                    <section className="robot-metadata-editor" aria-labelledby={`robot-metadata-${robot.id}`}>
                        <header className="robot-metadata-heading">
                            <div><span className="robot-editor-kicker">Design record</span><h5 id={`robot-metadata-${robot.id}`}>Robot details</h5></div>
                            <p>Give this robot its identity and a place in your team’s timeline.</p>
                        </header>
                        <label className="robot-metadata-field robot-name-field">
                            <span>Robot name</span>
                            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Atlas" />
                        </label>
                        <fieldset className="robot-date-fields">
                            <legend>Build timeline</legend>
                            <label className="robot-metadata-field robot-date-field">
                                <span>First built</span>
                                <input required type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} />
                                <small>When they started using this bot (beep boop)</small>
                            </label>
                            <label className="robot-metadata-field robot-date-field">
                                <span>Retired</span>
                                <input type="month" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />
                                <small>Leave blank if this is the current robot (beep bop boopity</small>
                            </label>
                        </fieldset>
                        <label className="robot-metadata-field robot-bio-field">
                            <span>Robot bio</span>
                            <textarea maxLength={2000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Share what this design does well, how it evolved, and what makes it unique." />
                            <small>put robot notes here :D</small>
                        </label>
                    </section>
                    <h5 className="robot-photo-editor-heading">Robot photos</h5>
                    {images.length > 0 && (
                        <div className="robot-images">
                            {images.map((photo, index) => {
                                const alt = `${robot.name}, robot photo ${index + 1}`;
                                return (
                                    <div className="robot-photo" key={photo.id}>
                                        <button className="robot-photo-button" type="button" onClick={() => setFullscreenPhoto({ photo, alt })} aria-label={`View ${alt} fullscreen`}>
                                            <img src={photo.url} alt={alt} loading="lazy" />
                                        </button>
                                        <button className="delete-robot-photo" type="button" aria-label={`Delete ${alt}`} title="Remove photo (saved when you click Save)" onClick={() => {
                                            setImages((current) => current.filter((image) => image.id !== photo.id));
                                            if (fullscreenPhoto?.photo.id === photo.id) setFullscreenPhoto(null);
                                        }}><TrashIcon /></button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {photoError && <p className="robot-photo-error" role="alert">{photoError}</p>}
                    <button className="add-photo-button" type="button" onClick={addPhoto} disabled={images.length >= 8}>＋ Add photo</button>
                    {formError && <p className="lookup-error" role="alert">{formError}</p>}
                    <div className="robot-form-actions robot-edit-actions">
                        <button className="search-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
                        <button className="robot-cancel-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
                    </div>
                </form>
            ) : (
                <>
                    {robot.description && <p className="robot-description">{robot.description}</p>}
                    {robot.imageUrls.length > 0 && (
                        <div className="robot-images">
                            {robot.imageUrls.map((photo, index) => {
                                const alt = `${robot.name}, robot photo ${index + 1}`;
                                return <button className="robot-photo-button" key={photo.id} type="button" onClick={() => setFullscreenPhoto({ photo, alt })} aria-label={`View ${alt} fullscreen`}><img src={photo.url} alt={alt} loading="lazy" /></button>;
                            })}
                        </div>
                    )}
                </>
            )}
            {fullscreenPhoto && (
                <div className="robot-lightbox" role="dialog" aria-modal="true" aria-label="Fullscreen robot photo" onClick={() => setFullscreenPhoto(null)}>
                    <button ref={closeButtonRef} className="robot-lightbox-close" type="button" aria-label="Close fullscreen image" onClick={() => setFullscreenPhoto(null)}>×</button>
                    <div className="robot-lightbox-content" onClick={(event) => event.stopPropagation()}>
                        <img src={fullscreenPhoto.photo.url} alt={fullscreenPhoto.alt} />
                        <p>Added by <strong>{fullscreenPhoto.photo.displayName}</strong></p>
                    </div>
                </div>
            )}
        </article>
    );

    function addPhoto() {
        const url = window.prompt("Enter a direct link to one robot photo:");
        if (url === null) return;
        setPhotoError("");
        const trimmedUrl = url.trim();
        try {
            const parsed = new URL(trimmedUrl);
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an http or https image URL.");
        } catch {
            setPhotoError("Enter a valid image URL using http or https.");
            return;
        }
        if (trimmedUrl.length > 2048) {
            setPhotoError("Image URLs must be 2,048 characters or fewer.");
            return;
        }
        setImages((current) => [...current, {
            id: crypto.randomUUID(),
            url: trimmedUrl,
            addedBy: null,
            displayName: "You (pending save)",
        }]);
    }
}

function TrashIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m4 4v6m6-6v6" />
    </svg>;
}

function formatMonth(value: string) {
    const [year, month] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// little icon component to mark official first data
function SourceMark({ league = "FTC" }: { league?: "FTC" | "FRC" }) {
    return league === "FRC"
        ? <a className="tba-source-mark" href="https://www.thebluealliance.com" target="_blank" rel="noreferrer" aria-label="Data from The Blue Alliance">TBA</a>
        : <img className="first-mark" src="/first.png" alt="From FIRST" title="Data from FIRST" />;
}

// generic list component to render lists like awards
function ResultList({ title, items, primaryKeys, league, firstSource = true }: { title: string; items: JsonRecord[]; primaryKeys: string[]; league: "FTC" | "FRC"; firstSource?: boolean }) {
    return (
        <section className="result-list">
            <h3>{firstSource && <SourceMark league={league} />}{title}</h3>
            {items.length ? items.slice(0, 12).map((item, index) => <p key={`${title}-${index}`}>{firstSource && <SourceMark league={league} />}{textValue(item, primaryKeys) || "Record available"}</p>) : <p className="muted">No records returned.</p>}
        </section>
    );
}

// renders event lists and form to create custom events
function EventList({ league, items, customEvents, onCreate }: { league: "FTC" | "FRC"; items: JsonRecord[]; customEvents: TeamLookupResponse["customEvents"]; onCreate: (name: string, date: string) => Promise<void> }) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [date, setDate] = useState("");
    return <section className="result-list"><h3><SourceMark league={league} />Events <button className="event-add-button" type="button" onClick={() => setCreating(!creating)} aria-expanded={creating} title="Create a new event">+</button></h3>
        {creating && <form className="new-event-form" onSubmit={(event) => { event.preventDefault(); void onCreate(name, date).then(() => { setName(""); setDate(""); setCreating(false); }); }}><input aria-label="Event name" placeholder="New event name" value={name} onChange={(event) => setName(event.target.value)} /><input aria-label="Event date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="submit">Create</button></form>}
        {items.length ? items.slice(0, 12).map((item, index) => <p className="event-row" key={`first-${index}`}><SourceMark league={league} /><span>{textValue(item, ["name", "eventName", "code", "key"]) || "Event"}</span><strong className="custom-event-date">{firstEventDate(item)}</strong></p>) : <p className="muted">No {league} events returned.</p>}
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
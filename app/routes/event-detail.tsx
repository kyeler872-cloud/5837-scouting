import { useAuth } from "@clerk/react-router";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import type { Route } from "./+types/event-detail";
import { Protected } from "../protected";
import { TopNavigation } from "../components/top-navigation";
import { trackRecentPage } from "../recent-pages.client";
import { AutoPathField, type AutoPath } from "../components/auto-path-field";
import field2026Image from "./Biobuzzfield.png";
import field2025Image from "./FTC2025field.png";

type League = "FTC" | "FRC";
type EventTeam = { number: string; name: string; manual: boolean };
type MatchPhase = "Auto" | "TeleOp" | "Endgame";
type MatchNote = { id: string; value: string; displayName: string };
type EventAuto = { id: string; name: string; alliance: "red" | "blue"; score: number | null; path: AutoPath };
type MatchAutoSelection = {
	teamNumber: string;
	robotId: string;
	autoId: string;
	autoName: string;
	path: AutoPath;
	displayName: string;
};
type MatchAutoDraft = { teamNumber: string; type: "new" | "existing"; autoId: string; path: AutoPath };
const EMPTY_AUTO_PATH: AutoPath = { points: [], controls: [] };
type EventMatch = {
	matchKey: string;
	qualificationNumber: number;
	teams: string[];
	redTeams: string[];
	blueTeams: string[];
	scheduledTime: string | null;
	redScore: number | null;
	blueScore: number | null;
	completed: boolean;
	notes: Partial<Record<MatchPhase, MatchNote[]>>;
	autoPath: { path: AutoPath; displayName: string } | null;
	autoSelections: MatchAutoSelection[];
};
type EventData = {
	league: League;
	season: string;
	eventCode: string;
	event: { name: string; startDate: string | null; endDate: string | null; city: string; state: string; country: string; region: string; custom: boolean };
	teams: EventTeam[];
	activeRobots: Record<string, { id: string; name: string; autos: EventAuto[] }>;
	matches: EventMatch[];
	notes: Record<string, { value: string; displayName: string }>;
	photosUrl: string;
	warning: string | null;
};
type NoteCategory = "Matches" | "Playoffs" | "Notes";
const categories: NoteCategory[] = ["Matches", "Playoffs", "Notes"];
const matchPhases: MatchPhase[] = ["Auto", "TeleOp", "Endgame"];

async function readResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

function displayDate(start: string | null, end: string | null) {
	if (!start) return "Date unavailable";
	const format = (value: string) => {
		const date = new Date(`${value.slice(0, 10)}T00:00:00`);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
	};
	return end && end !== start ? `${format(start)} – ${format(end)}` : format(start);
}

function searchTeamUrl(league: League, season: string, number: string) {
	const params = new URLSearchParams({ league, season, team: number });
	return `/home?${params}`;
}

function renderLinkedTeamNumbers(text: string, league: League, season: string) {
	return text.split(/(\b\d{4,5}\b)/g).map((part, index) => /^\d{4,5}$/.test(part)
		? <a className="event-note-team-link" key={`${part}-${index}`} href={searchTeamUrl(league, season, part)}>{part}</a>
		: part);
}

function matchTimeLabel(value: string | null) {
	if (!value) return "Time TBD";
	const time = new Date(value);
	return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function initialAutoDraft(match: EventMatch): MatchAutoDraft {
	const selected = match.autoSelections[0];
	return {
		teamNumber: selected?.teamNumber || "",
		type: selected ? "existing" : "new",
		autoId: selected?.autoId || "",
		path: selected?.path || EMPTY_AUTO_PATH,
	};
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Event | Scout 5837" }, { name: "description", content: "Event details, team roster, and scouting notes." }];
}

export default function EventDetailPage() {
	const { getToken } = useAuth();
	const params = useParams();
	const location = useLocation();
	const league = params.league?.toUpperCase() === "FRC" ? "FRC" : "FTC";
	const season = params.season || "";
	const eventCode = params.eventCode || "";
	const [eventData, setEventData] = useState<EventData | null>(null);
	const [category, setCategory] = useState<NoteCategory>("Matches");
	const [draft, setDraft] = useState("");
	const [teamNumber, setTeamNumber] = useState("");
	const [teamName, setTeamName] = useState("");
	const [matchNoteDrafts, setMatchNoteDrafts] = useState<Record<string, string>>({});
	const [matchAutoDrafts, setMatchAutoDrafts] = useState<Record<string, MatchAutoDraft>>({});
	const [editingMatchKey, setEditingMatchKey] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [teamHighlightError, setTeamHighlightError] = useState("");
	const [highlightedTeamNumbers, setHighlightedTeamNumbers] = useState<string[]>([]);
	const [showAllMatches, setShowAllMatches] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const query = new URLSearchParams(location.search);
	const selectedMatchKey = query.get("match") || "";
	const lastScrolledMatchKey = useRef("");
	const requestedReturn = query.get("returnTo") || "";
	const returnTo = requestedReturn.startsWith("/home") || requestedReturn.startsWith("/events") ? requestedReturn : "/events";

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 560px)");
		const updateLayout = () => setIsMobile(mediaQuery.matches);
		updateLayout();
		mediaQuery.addEventListener("change", updateLayout);
		return () => mediaQuery.removeEventListener("change", updateLayout);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			setLoading(true);
			setEventData(null);
			setError("");
			setTeamHighlightError("");
			setHighlightedTeamNumbers([]);
			setShowAllMatches(false);
			try {
				const token = await getToken();
				const response = await fetch(`/api/events/${league}/${encodeURIComponent(season)}/${encodeURIComponent(eventCode)}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<EventData | { error?: string }>(response);
				if (!response.ok) throw new Error("error" in data ? data.error || "Could not load event." : "Could not load event.");
				if (!cancelled) {
					const loaded = data as EventData;
					setEventData(loaded);
					setDraft(loaded.notes[category]?.value || "");
					setMatchAutoDrafts(Object.fromEntries(loaded.matches.map((match) => [match.matchKey, initialAutoDraft(match)])));
				}
				try {
					const settingsResponse = await fetch("/api/settings?scope=personal", {
						headers: token ? { Authorization: ["Bearer", token].join(" ") } : undefined,
					});
					const settingsData = await readResponse<{
						personal?: { ftcTeamNumber?: number; teamPreset?: string };
						error?: string;
					}>(settingsResponse);
					if (!settingsResponse.ok || !settingsData.personal) {
						throw new Error(settingsData.error || "Could not load your account team settings.");
					}
					if (!cancelled) {
						const personal = settingsData.personal;
						setHighlightedTeamNumbers(league === "FRC"
							? ["5837"]
							: personal.teamPreset === "SLB"
								? ["7247", "5445"]
								: typeof personal.ftcTeamNumber === "number"
									? [String(personal.ftcTeamNumber)]
									: []);
					}
				} catch (settingsError) {
					if (!cancelled) {
						setTeamHighlightError(settingsError instanceof Error
							? `Your team matches could not be highlighted: ${settingsError.message}`
							: "Your team matches could not be highlighted.");
					}
				}
			} catch (loadError) {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load event.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		void load();
		return () => { cancelled = true; };
	}, [getToken, league, season, eventCode]);

	useEffect(() => {
		setDraft(eventData?.notes[category]?.value || "");
	}, [category, eventData]);

	useEffect(() => {
		if (!eventData) return;
		const selectedMatch = eventData.matches.find((match) => match.matchKey === selectedMatchKey);
		trackRecentPage(
			`${location.pathname}${location.search}`,
			eventData.event.name,
			`${league} ${season} · ${eventCode}${selectedMatch ? ` · Qualification ${selectedMatch.qualificationNumber}` : ""}`,
		);
	}, [eventData, eventCode, league, location.pathname, location.search, season, selectedMatchKey]);

	useEffect(() => {
		if (!eventData || !selectedMatchKey || lastScrolledMatchKey.current === selectedMatchKey) return;
		const match = eventData.matches.find((item) => item.matchKey === selectedMatchKey);
		if (!match) return;
		lastScrolledMatchKey.current = selectedMatchKey;
		document.getElementById(`qualification-${selectedMatchKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	}, [eventData, selectedMatchKey]);

	async function save(action: Record<string, unknown>) {
		setSaving(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch(`/api/events/${league}/${encodeURIComponent(season)}/${encodeURIComponent(eventCode)}`, {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify(action),
			});
			const data = await readResponse<Record<string, unknown> & { error?: string }>(response);
			if (!response.ok) throw new Error(data.error || "Could not save event changes.");
			if (action.action === "note" && eventData && typeof data.category === "string") {
				const note = data.note as { value: string; displayName: string };
				setEventData({ ...eventData, notes: { ...eventData.notes, [data.category]: note } });
			} else if (action.action === "match-note" && eventData && typeof data.matchKey === "string" && typeof data.phase === "string") {
				const note = data.note as MatchNote;
				setEventData({
					...eventData,
					matches: eventData.matches.map((match) => match.matchKey === data.matchKey
						? { ...match, notes: { ...match.notes, [data.phase as MatchPhase]: [...(match.notes[data.phase as MatchPhase] || []), note] } }
						: match),
				});
				setMatchNoteDrafts((drafts) => ({ ...drafts, [`${data.matchKey}-${data.phase}`]: "" }));
			} else if (action.action === "photos" && eventData && typeof data.photosUrl === "string") {
				setEventData({ ...eventData, photosUrl: data.photosUrl });
			} else if (eventData) {
				await reloadEvent();
			}
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not save event changes.");
			throw saveError;
		} finally {
			setSaving(false);
		}
	}

	async function reloadEvent() {
		const token = await getToken();
		const response = await fetch(`/api/events/${league}/${encodeURIComponent(season)}/${encodeURIComponent(eventCode)}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		});
		const data = await readResponse<EventData | { error?: string }>(response);
		if (!response.ok) throw new Error("error" in data ? data.error || "Could not reload event." : "Could not reload event.");
		const loaded = data as EventData;
		setEventData(loaded);
		setMatchAutoDrafts(Object.fromEntries(loaded.matches.map((match) => [match.matchKey, initialAutoDraft(match)])));
	}

	async function editPhotosLink() {
		const value = window.prompt("Enter the link to the event photos:", eventData?.photosUrl || "");
		if (value === null) return;
		try {
			await save({ action: "photos", photosUrl: value.trim() });
		} catch {
			// The error is displayed by the page-level alert.
		}
	}

	async function addTeam(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			await save({ action: "add-team", teamNumber, teamName });
			setTeamNumber("");
			setTeamName("");
		} catch {
			// Keep the form values available for correction and retry.
		}
	}

	async function removeTeam(number: string) {
		try {
			await save({ action: "remove-team", teamNumber: number });
		} catch {
			// The visible roster remains unchanged when the request fails.
		}
	}

	const displayedMatches = (eventData?.matches || []).filter((match) =>
		showAllMatches || match.matchKey === selectedMatchKey || match.teams.some((number) => highlightedTeamNumbers.includes(number))
	);

	return (
		<Protected>
			<main className="home-shell">
				<TopNavigation currentPage="events" />
				<div className="event-detail-page">
					<a className="event-back-link" href={returnTo}>← Back</a>
					{loading && <p className="event-page-status" aria-busy="true">Loading event...</p>}
					{error && <p className="lookup-error" role="alert">{error}</p>}
					{teamHighlightError && <p className="lookup-warning" role="status">{teamHighlightError}</p>}
					{eventData && <>
						<header className="event-detail-heading">
							<p className="section-kicker">{league} / {season} season {eventData.event.custom ? "· Custom event" : ""}</p>
							<h1>{eventData.event.name}</h1>
							<p>{displayDate(eventData.event.startDate, eventData.event.endDate)}</p>
							<p>{[eventData.event.city, eventData.event.state, eventData.event.country].filter(Boolean).join(", ") || eventData.event.region}</p>
							{eventData.photosUrl ? <div className="event-photo-actions">
								<a className="event-photos-button" href={eventData.photosUrl} target="_blank" rel="noreferrer"><PhotoIcon /> Photos</a>
								<button className="event-photo-edit" type="button" onClick={() => void editPhotosLink()} aria-label="Edit photos link" title="Edit photos link"><PencilIcon /></button>
							</div> : <button className="event-add-photo-link" type="button" onClick={() => void editPhotosLink()}>＋ Add photos link</button>}
						</header>
						{eventData.warning && <p className="lookup-warning" role="status">{eventData.warning}</p>}
						<div className="event-detail-grid">
							<section className="event-roster" aria-labelledby="event-roster-heading">
								<details className="event-mobile-disclosure" key={isMobile ? "mobile" : "desktop"} open={!isMobile}>
									<summary>
										<p className="section-kicker">Participating teams</p>
										<h2 id="event-roster-heading">Teams <span>{eventData.teams.length}</span></h2>
									</summary>
									<div className="event-roster-content">
										{eventData.event.custom && <form className="manual-team-form" onSubmit={(event) => void addTeam(event)}>
											<input required inputMode="numeric" pattern="[0-9]*" maxLength={6} aria-label="Team number" placeholder={`${league} team number`} value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} />
											<input aria-label="Team name (optional)" maxLength={200} placeholder="Team name (optional)" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
											<button type="submit" disabled={saving}>Import team</button>
										</form>}
										{eventData.teams.length ? <ul className="event-team-list">{eventData.teams.map((team) => <li key={team.number}>
											<span className="event-team-name"><strong>{league} {team.number}</strong>{team.name && <span>{team.name}</span>}{team.manual && <small>Manual</small>}</span>
											<span className="event-team-actions">
												<a className="event-team-search" href={searchTeamUrl(league, season, team.number)} target="_blank" rel="noreferrer" aria-label={`Search ${league} team ${team.number}`} title={`Search ${league} team ${team.number}`}><SearchIcon /></a>
												{team.manual && eventData.event.custom && <button className="event-team-remove" type="button" onClick={() => void removeTeam(team.number)} aria-label={`Remove team ${team.number}`}>×</button>}
											</span>
										</li>)}</ul> : <p className="empty-event-results">No teams are listed for this event.</p>}
									</div>
								</details>
							</section>
							<section className="event-notes" aria-labelledby="event-notes-heading">
								<p className="section-kicker">Shared event notes</p>
								<h2 id="event-notes-heading">General event notes</h2>
								<div className="event-note-tabs" role="tablist" aria-label="Note category">
									{categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
								</div>
								<label className="event-note-editor"><span>{category}</span><textarea rows={12} maxLength={10000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Add ${category.toLowerCase()} notes for this event...`} /></label>
								<div className="event-note-actions"><button className="search-button" type="button" disabled={saving} onClick={() => void save({ action: "note", category, note: draft }).catch(() => undefined)}>{saving ? "Saving..." : "Save notes"}</button><span>{eventData.notes[category]?.displayName ? `Last updated by ${eventData.notes[category].displayName}` : "No notes yet"}</span></div>
							</section>
						</div>
						<section className="event-qualifications" aria-labelledby="event-qualifications-heading">
							<details className="event-mobile-disclosure" key={isMobile ? "mobile" : "desktop"} open={!isMobile || Boolean(selectedMatchKey)}>
								<summary>
									<header className="event-qualifications-heading">
										<div><p className="section-kicker">Match scouting</p><h2 id="event-qualifications-heading">Qualification matches</h2></div>
										<p>Map FTC autonomous paths and save all edited match fields together.</p>
									</header>
								</summary>
								<button className="event-match-filter" type="button" aria-pressed={showAllMatches} onClick={() => setShowAllMatches((showingAll) => !showingAll)}>
									{showAllMatches ? "Show only my matches" : "Show all matches"}
								</button>
								{displayedMatches.length ? <div className="event-qualification-list">{displayedMatches.map((match) => {
								const hasNotes = matchPhases.some((phase) => Boolean(match.notes[phase]?.length)) || Boolean(match.autoPath) || match.autoSelections.length > 0;
								const isEditing = editingMatchKey === match.matchKey;
								const featuresAccountTeam = match.teams.some((number) => highlightedTeamNumbers.includes(number));
								const canMapAuto = league === "FTC" && (season === "2025" || season === "2026");
								const autoDraft = matchAutoDrafts[match.matchKey] || initialAutoDraft(match);
								const mapSeason = season;
								const autoFieldProps = {
									fieldImage: mapSeason === "2025" ? field2025Image : field2026Image,
									seasonLabel: mapSeason === "2025" ? "2025–26" : "2026–27",
								};
								const selectedRobot = autoDraft.teamNumber ? eventData.activeRobots[autoDraft.teamNumber] : undefined;
								const selectedExistingAuto = selectedRobot?.autos.find((auto) => auto.id === autoDraft.autoId);
								const savedTeamSelection = match.autoSelections.find((selection) => selection.teamNumber === autoDraft.teamNumber);
								const autoMappingChanged = canMapAuto && Boolean(autoDraft.teamNumber) && (
									autoDraft.type === "new"
										? autoDraft.path.points.length >= 2
										: Boolean(selectedExistingAuto) && savedTeamSelection?.autoId !== autoDraft.autoId
								);
								const blueScoreClass = !match.completed || match.blueScore === match.redScore
									? ""
									: match.blueScore! > match.redScore! ? "dashboard-result-score-winning" : "dashboard-result-score-losing";
								const redScoreClass = !match.completed || match.redScore === match.blueScore
									? ""
									: match.redScore! > match.blueScore! ? "dashboard-result-score-winning" : "dashboard-result-score-losing";
								return <details className="event-qualification" id={`qualification-${match.matchKey}`} key={match.matchKey} open={selectedMatchKey ? match.matchKey === selectedMatchKey : false}>
								<summary><strong className={featuresAccountTeam ? "event-qualification-featured" : undefined}>Qualification {match.qualificationNumber}</strong>{hasNotes && <span className="event-qualification-note-indicator" role="img" aria-label="Notes saved" title="Notes saved"><NotesIcon /></span>}<time>{matchTimeLabel(match.scheduledTime)}</time><span>{match.teams.length ? `${match.teams.length} teams` : "Teams unavailable"}</span></summary>
								<div className="event-qualification-content">
									<div className="dashboard-result-alliances event-qualification-alliances" aria-label={match.completed ? `Final score: blue ${match.blueScore}, red ${match.redScore}` : "Qualification alliances"}>
										<section className="dashboard-result-blue">
											<h4>Blue <strong className={blueScoreClass}>{match.blueScore ?? "—"}</strong></h4>
											<div>{match.blueTeams.length ? match.blueTeams.map((number) => <a href={searchTeamUrl(league, season, number)} key={number}>{number}</a>) : <small>Teams unavailable</small>}</div>
										</section>
										<section className="dashboard-result-red">
											<h4><strong className={redScoreClass}>{match.redScore ?? "—"}</strong> Red</h4>
											<div>{match.redTeams.length ? match.redTeams.map((number) => <a href={searchTeamUrl(league, season, number)} key={number}>{number}</a>) : <small>Teams unavailable</small>}</div>
										</section>
									</div>
									<header className="event-qualification-notes-heading"><h3>Scouting notes</h3>{canMapAuto && <button className="event-qualification-edit" type="button" aria-expanded={isEditing} onClick={() => {
										if (isEditing) {
											setMatchAutoDrafts((current) => ({ ...current, [match.matchKey]: initialAutoDraft(match) }));
											setEditingMatchKey(null);
										} else {
											setEditingMatchKey(match.matchKey);
										}
									}}>{isEditing ? "Cancel auto edits" : <><PencilIcon />Edit autos</>}</button>}</header>
									<div className="event-match-saved-phases">{matchPhases.map((phase) => {
										const phaseNotes = match.notes[phase] || [];
										const draftKey = `${match.matchKey}-${phase}`;
										return <section key={phase}><h4>{phase} notes</h4>
											{phaseNotes.map((note) => <article className="event-match-note-entry" key={note.id}>
												<div className="event-match-saved-note">{renderLinkedTeamNumbers(note.value, league, season)}</div>
												<small>Added by: {note.displayName}</small>
											</article>)}
											{!phaseNotes.length && <p>No notes yet</p>}
											<form className="event-match-note-form" onSubmit={(event) => {
												event.preventDefault();
												void save({ action: "match-note", matchKey: match.matchKey, category: phase, note: matchNoteDrafts[draftKey] || "" }).catch(() => undefined);
											}}>
												<label><span>Add {phase.toLowerCase()} note</span><textarea rows={3} maxLength={10000} value={matchNoteDrafts[draftKey] || ""} onChange={(event) => setMatchNoteDrafts((drafts) => ({ ...drafts, [draftKey]: event.target.value }))} placeholder={`Record ${phase.toLowerCase()} notes...`} /></label>
												<button className="search-button" type="submit" disabled={saving || !matchNoteDrafts[draftKey]?.trim()}>{saving ? "Adding..." : "Add note"}</button>
											</form>
										</section>;
									})}</div>
									{canMapAuto && <section className="event-match-auto-map">
										<h4>Qualification autos</h4>
										{isEditing ? <>
											<label className="event-auto-team-select"><span>Team</span><select required value={autoDraft.teamNumber} onChange={(event) => {
												const nextTeam = event.target.value;
												const selection = match.autoSelections.find((item) => item.teamNumber === nextTeam);
												setMatchAutoDrafts((current) => ({
													...current,
													[match.matchKey]: {
														teamNumber: nextTeam,
														type: selection ? "existing" : "new",
														autoId: selection?.autoId || "",
														path: selection?.path || EMPTY_AUTO_PATH,
													},
												}));
											}}>
												<option value="">Select a team in this match</option>
												{match.teams.map((number) => <option value={number} key={number}>{number}</option>)}
											</select></label>
											{autoDraft.teamNumber && <>
												<label className="event-auto-team-select"><span>Routine</span><select value={autoDraft.type} onChange={(event) => setMatchAutoDrafts((current) => ({
													...current,
													[match.matchKey]: { ...autoDraft, type: event.target.value === "existing" ? "existing" : "new", autoId: "" },
												}))}>
													<option value="new">Map a new auto</option>
													<option value="existing" disabled={!selectedRobot?.autos.length}>Select an existing auto</option>
												</select></label>
												{autoDraft.type === "existing" ? <>
													{selectedRobot?.autos.length ? <>
														<label className="event-auto-team-select"><span>Saved auto on {selectedRobot.name || "active robot"}</span><select required value={autoDraft.autoId} onChange={(event) => setMatchAutoDrafts((current) => ({
															...current,
															[match.matchKey]: { ...autoDraft, autoId: event.target.value },
														}))}>
															<option value="">Select an auto</option>
															{selectedRobot.autos.map((auto) => <option key={auto.id} value={auto.id}>{auto.name || "Unnamed auto"} ({auto.alliance})</option>)}
														</select></label>
														{selectedExistingAuto && <><AutoPathField key={mapSeason} path={selectedExistingAuto.path} {...autoFieldProps} /><small>Existing auto; selecting it will not change its saved path.</small></>}
													</> : <p>No saved autos are available. Choose “Map a new auto” to create one.</p>}
												</> : <>
													{!selectedRobot && <p>This team has no active robot; an unnamed robot will be created when this auto is saved.</p>}
													<AutoPathField key={mapSeason} path={autoDraft.path} editable {...autoFieldProps} onChange={(path) => setMatchAutoDrafts((current) => ({ ...current, [match.matchKey]: { ...autoDraft, path } }))} />
													<p>The mapped path will be added as an unnamed auto to this team’s active robot.</p>
												</>}
											</>}
										</> : <>
											{match.autoSelections.length > 0 ? match.autoSelections.map((selection) => <section className="event-match-saved-auto" key={selection.teamNumber}>
												<h5>Team {selection.teamNumber}: {selection.autoName || "Unnamed auto"}</h5>
												<AutoPathField key={mapSeason} path={selection.path} {...autoFieldProps} />
												<small>Recorded by {selection.displayName}</small>
											</section>) : match.autoPath
												? <><AutoPathField key={mapSeason} path={match.autoPath.path} {...autoFieldProps} /><small>Legacy path mapped by {match.autoPath.displayName}; select a team to associate an auto.</small></>
												: <p>No team autos recorded for this qualification.</p>}
										</>}
									</section>}
									{isEditing && <div className="event-match-save-actions">
										<button className="search-button" type="button" disabled={saving || !autoMappingChanged} onClick={async () => {
											try {
												await save({
													action: "match-scouting",
													matchKey: match.matchKey,
													...(autoMappingChanged ? {
														autoMapping: {
															teamNumber: autoDraft.teamNumber,
															type: autoDraft.type,
															...(autoDraft.type === "existing" ? { autoId: autoDraft.autoId } : { path: autoDraft.path }),
														},
													} : {}),
												});
												setEditingMatchKey(null);
											} catch {
												// Keep the editor open so the changes can be corrected and retried.
											}
										}}>{saving ? "Saving..." : "Save auto mapping"}</button>
										<span>{autoMappingChanged ? "Auto mapping changed" : "No auto changes"}</span>
									</div>}
								</div>
								</details>;
								})}</div> : <p className="empty-event-results">{eventData.matches.length ? "No qualification matches featuring your account teams are available." : "No qualification matches are available for this event."}</p>}
							</details>
						</section>
					</>}
				</div>
			</main>
		</Protected>
	);
}

function SearchIcon() {
	return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></svg>;
}

function PencilIcon() {
	return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" /></svg>;
}

function NotesIcon() {
	return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" /><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7" /></svg>;
}

function PhotoIcon() {
	return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="m5 17 5-4.5 3.2 2.6 2.3-2 3.5 3.1" /></svg>;
}

import { useAuth, useUser } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { ScoreTrendChart, type EventPerformance } from "./score-trend-chart";
import { TopNavigation } from "./top-navigation";

type League = "FTC" | "FRC";
type RecordValue = Record<string, unknown>;
type DashboardShortcut = {
	id: string;
	kind: "event" | "team" | "comparison";
	label: string;
	league: League;
	season: string;
	teamNumber?: string;
	eventCode?: string;
};
type PersonalSettings = { teamNumber: number; theme: "dark" | "light"; shortcuts: DashboardShortcut[] };
type ContributorSession = { required: boolean; name: string | null; expiresAt: string | null };
type TeamData = {
	teamNumber: string;
	events: RecordValue | RecordValue[] | null;
	performanceByEvent: EventPerformance[];
	robots: { id: string; name: string; description: string; imageUrls: { url: string }[]; endMonth: string | null }[];
	customEvents: { code: string; name: string; date: string | null }[];
};
type EventLink = { code: string; name: string; start: string | null; end: string | null; custom?: boolean };
type ScheduleMatch = {
	matchKey: string;
	qualificationNumber: number;
	teams: string[];
	redTeams: string[];
	blueTeams: string[];
	scheduledTime: string | null;
	completed: boolean;
	prediction: { redScore: number | null; blueScore: number | null; redWinProbability: number | null };
};
type EventSchedule = { matches: ScheduleMatch[] };
type ShortcutKind = DashboardShortcut["kind"];

const season = "2026";

async function readResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

function value(record: RecordValue, keys: string[]) {
	for (const key of keys) {
		const field = record[key];
		if (typeof field === "string" && field.trim()) return field.trim();
		if (typeof field === "number") return String(field);
	}
	return "";
}

function records(input: RecordValue | RecordValue[] | null) {
	if (Array.isArray(input)) return input;
	if (!input) return [];
	for (const key of ["events", "matches", "data", "items"]) {
		if (Array.isArray(input[key])) return input[key] as RecordValue[];
	}
	return [input];
}

function eventRecords(data: TeamData, league: League): EventLink[] {
	const events = records(data.events).map((event) => ({
		code: value(event, league === "FTC" ? ["code"] : ["key"]).replace(/^frc/, ""),
		name: value(event, ["name", "eventName", "code", "key"]) || "Event",
		start: value(event, ["dateStart", "start_date", "startDate"]) || null,
		end: value(event, ["dateEnd", "end_date", "endDate"]) || null,
	})).filter((event) => event.code);
	return [
		...events,
		...data.customEvents.map((event) => ({ code: event.code, name: event.name, start: event.date, end: event.date, custom: true })),
	].sort((first, second) => (first.start || "9999").localeCompare(second.start || "9999"));
}

function eventHref(event: EventLink, league: League, teamNumber: string, matchKey?: string) {
	const returnTo = `/home?${new URLSearchParams({ team: teamNumber, league, season })}`;
	const query = new URLSearchParams({ returnTo });
	if (matchKey) query.set("match", matchKey);
	return `/events/${league}/${season}/${encodeURIComponent(event.code)}?${query}`;
}

function dateLabel(start: string | null, end: string | null) {
	if (!start) return "Dates unavailable";
	const format = (date: string) => {
		const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
		return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	};
	return end && end !== start ? `${format(start)} - ${format(end)}` : format(start);
}

function activeEvent(events: EventLink[]) {
	const today = new Date().toISOString().slice(0, 10);
	return events.find((event) => event.start && event.end && event.start.slice(0, 10) <= today && event.end.slice(0, 10) >= today) || null;
}

function matchTime(match: RecordValue) {
	const raw = match.time ?? match.scheduledTime;
	if (typeof raw === "number") return new Date(raw < 10_000_000_000 ? raw * 1000 : raw);
	if (typeof raw === "string") {
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return null;
}

function shortcutHref(shortcut: DashboardShortcut) {
	if (shortcut.kind === "event" && shortcut.eventCode) {
		return `/events/${shortcut.league}/${shortcut.season}/${encodeURIComponent(shortcut.eventCode)}`;
	}
	if (!shortcut.teamNumber) return "/home";
	const params = new URLSearchParams({ team: shortcut.teamNumber, league: shortcut.league, season: shortcut.season });
	return shortcut.kind === "comparison" ? `/compare?${params}` : `/home?${params}`;
}

export function ScoutingDashboard() {
	const { getToken } = useAuth();
	const { user } = useUser();
	const [personal, setPersonal] = useState<PersonalSettings>({ teamNumber: 5837, theme: "dark", shortcuts: [] });
	const [team, setTeam] = useState<TeamData | null>(null);
	const [schedule, setSchedule] = useState<EventSchedule | null>(null);
	const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
	const [scheduleError, setScheduleError] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [showShortcutForm, setShowShortcutForm] = useState(false);
	const [shortcutKind, setShortcutKind] = useState<ShortcutKind>("event");
	const [shortcutLabel, setShortcutLabel] = useState("");
	const [shortcutLeague, setShortcutLeague] = useState<League>("FTC");
	const [shortcutSeason, setShortcutSeason] = useState(season);
	const [shortcutTeam, setShortcutTeam] = useState("");
	const [shortcutEvent, setShortcutEvent] = useState("");
	const [savingShortcut, setSavingShortcut] = useState(false);
	const [contributor, setContributor] = useState<ContributorSession>({ required: false, name: null, expiresAt: null });
	const [showContributorEditor, setShowContributorEditor] = useState(false);
	const [contributorDraft, setContributorDraft] = useState("");
	const [savingContributor, setSavingContributor] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			setLoading(true);
			setError("");
			try {
				const token = await getToken();
				const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
				const [settingsResponse, contributorResponse] = await Promise.all([
					fetch("/api/settings?scope=personal", { headers }),
					fetch("/api/settings?scope=contributor", { headers }),
				]);
				const settingsData = await readResponse<{ personal?: PersonalSettings; error?: string }>(settingsResponse);
				if (!settingsResponse.ok || !settingsData.personal) throw new Error(settingsData.error || "Could not load your personal settings.");
				const contributorData = await readResponse<{ contributor?: ContributorSession; error?: string }>(contributorResponse);
				if (!contributorResponse.ok || !contributorData.contributor) throw new Error(contributorData.error || "Could not load your credited name.");
				if (cancelled) return;
				setPersonal(settingsData.personal);
				setContributor(contributorData.contributor);
				setContributorDraft(contributorData.contributor.name || "");
				const number = String(settingsData.personal.teamNumber);
				const league: League = number === "5837" ? "FRC" : "FTC";
				const teamResponse = await fetch(`/api/teams/${encodeURIComponent(number)}?${new URLSearchParams({ league: league.toLowerCase(), season })}`, { headers });
				const teamData = await readResponse<TeamData | { error?: string }>(teamResponse);
				if (!teamResponse.ok) throw new Error("error" in teamData ? teamData.error || "Could not load your team." : "Could not load your team.");
				if (!cancelled) setTeam(teamData as TeamData);
			} catch (loadError) {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the dashboard.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [getToken]);

	const teamNumber = String(personal.teamNumber);
	const league: League = teamNumber === "5837" ? "FRC" : "FTC";
	const events = team ? eventRecords(team, league) : [];
	const currentEvent = activeEvent(events);
	const currentRobots = team?.robots.filter((robot) => !robot.endMonth) || [];
	const upcomingEvents = events.filter((event) => !event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10)).slice(0, 5);
	const scheduleEvent = currentEvent || upcomingEvents[0] || events.at(-1) || null;
	const nextMatch = schedule?.matches.find((match) =>
		!match.completed && match.teams.includes(teamNumber) && (!match.scheduledTime || (matchTime({ scheduledTime: match.scheduledTime })?.getTime() || 0) >= Date.now()),
	) || schedule?.matches.find((match) => !match.completed && match.teams.includes(teamNumber)) || null;
	const isRedAlliance = nextMatch?.redTeams.includes(teamNumber) || false;
	const isBlueAlliance = nextMatch?.blueTeams.includes(teamNumber) || false;
	const allianceTeams = isRedAlliance ? nextMatch?.redTeams || [] : isBlueAlliance ? nextMatch?.blueTeams || [] : [];
	const opposingTeams = isRedAlliance ? nextMatch?.blueTeams || [] : nextMatch?.redTeams || [];
	const winProbability = nextMatch?.prediction.redWinProbability === null || nextMatch?.prediction.redWinProbability === undefined
		? null
		: isRedAlliance ? nextMatch.prediction.redWinProbability : 1 - nextMatch.prediction.redWinProbability;

	useEffect(() => {
		let cancelled = false;
		setSchedule(null);
		setScheduleError("");
		if (!scheduleEvent) return () => { cancelled = true; };
		setIsLoadingSchedule(true);
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch(`/api/events/${league}/${encodeURIComponent(season)}/${encodeURIComponent(scheduleEvent.code)}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<EventSchedule | { error?: string }>(response);
				if (!response.ok) throw new Error("error" in data ? data.error || "Could not load the event schedule." : "Could not load the event schedule.");
				if (!cancelled) setSchedule(data as EventSchedule);
			} catch (loadError) {
				if (!cancelled) setScheduleError(loadError instanceof Error ? loadError.message : "Could not load the event schedule.");
			} finally {
				if (!cancelled) setIsLoadingSchedule(false);
			}
		})();
		return () => { cancelled = true; };
	}, [getToken, league, scheduleEvent?.code]);

	async function saveContributorName(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSavingContributor(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ action: "contributor-name", contributorName: contributorDraft }),
			});
			const data = await readResponse<{ contributor?: ContributorSession; error?: string }>(response);
			if (!response.ok || !data.contributor) throw new Error(data.error || "Could not save your credited name.");
			setContributor(data.contributor);
			setContributorDraft(data.contributor.name || "");
			setShowContributorEditor(false);
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not save your credited name.");
		} finally {
			setSavingContributor(false);
		}
	}

	async function saveShortcuts(nextShortcuts: DashboardShortcut[]): Promise<boolean> {
		setSavingShortcut(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ personal: { ...personal, shortcuts: nextShortcuts } }),
			});
			const data = await readResponse<{ personal?: PersonalSettings; error?: string }>(response);
			if (!response.ok || !data.personal) throw new Error(data.error || "Could not save dashboard shortcuts.");
			setPersonal(data.personal);
			return true;
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : "Could not save dashboard shortcuts.");
			return false;
		} finally {
			setSavingShortcut(false);
		}
	}

	async function addShortcut(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (personal.shortcuts.length >= 12) return;
		const label = shortcutLabel.trim() || (shortcutKind === "event" ? shortcutEvent : shortcutTeam) || "Saved shortcut";
		const shortcut: DashboardShortcut = {
			id: crypto.randomUUID(), kind: shortcutKind, label, league: shortcutLeague, season: shortcutSeason,
			...(shortcutKind === "event" ? { eventCode: shortcutEvent.trim() } : { teamNumber: shortcutTeam.trim() }),
		};
		const saved = await saveShortcuts([...personal.shortcuts, shortcut]);
		if (!saved) return;
		setShortcutLabel("");
		setShortcutTeam("");
		setShortcutEvent("");
		setShowShortcutForm(false);
	}

	async function removeShortcut(id: string) {
		await saveShortcuts(personal.shortcuts.filter((shortcut) => shortcut.id !== id));
	}

	return (
		<main className="home-shell dashboard-shell">
			<TopNavigation currentPage="dashboard" />
			<div className="dashboard-page">
				<header className="dashboard-heading">
					<div><p className="section-kicker">{league} {season}-{String(Number(season) + 1).slice(-2)} season</p><h1>Welcome, {user?.username || user?.firstName || "scout"}</h1></div>
					<div className="dashboard-heading-actions">
						<a className="dashboard-team-link" href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`}>Team {teamNumber}<span aria-hidden="true">↗</span></a>
						{contributor.required && <button className="dashboard-contributor-edit" type="button" onClick={() => setShowContributorEditor((open) => !open)}>Change credited name</button>}
					</div>
				</header>
				{showContributorEditor && <form className="dashboard-contributor-form" onSubmit={(event) => void saveContributorName(event)}>
					<label htmlFor="dashboard-contributor-name">Credited name</label>
					<input id="dashboard-contributor-name" value={contributorDraft} onChange={(event) => setContributorDraft(event.target.value)} maxLength={12} required />
					<button className="search-button" type="submit" disabled={savingContributor || !contributorDraft.trim()}>{savingContributor ? "Saving..." : "Save for one hour"}</button>
					<button className="dashboard-contributor-cancel" type="button" onClick={() => { setContributorDraft(contributor.name || ""); setShowContributorEditor(false); }}>Cancel</button>
				</form>}
				{error && <p className="lookup-error" role="alert">{error}</p>}
				{loading ? <p className="dashboard-status" aria-busy="true">Loading your team dashboard...</p> : <div className="dashboard-grid">
					<section className="dashboard-tile dashboard-events-tile" aria-labelledby="dashboard-events-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">Competition schedule</p><h2 id="dashboard-events-title">Upcoming and current events</h2></div><a href="/events" aria-label="Browse events" title="Browse events">↗</a></header>
						{upcomingEvents.length ? <ul className="dashboard-event-list">{upcomingEvents.map((event) => <li key={event.code}>
							<a href={eventHref(event, league, teamNumber)}><span><strong>{event.name}</strong>{event.code === currentEvent?.code && <em>Live</em>}</span><small>{dateLabel(event.start, event.end)}</small></a>
						</li>)}</ul> : <p className="dashboard-empty">No events are listed for this team yet.</p>}
					</section>
					<section className="dashboard-tile dashboard-robot-tile" aria-labelledby="dashboard-robot-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">Build history</p><h2 id="dashboard-robot-title">Current robot</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team profile" title="Open team profile">↗</a></header>
						{currentRobots[0] ? <a className="dashboard-robot" href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`}>
							{currentRobots[0].imageUrls[0] && <img src={currentRobots[0].imageUrls[0].url} alt="" />}
							<div><strong>{currentRobots[0].name || "Current robot"}</strong><p>{currentRobots[0].description || "Open the team profile to see the robot details."}</p></div>
						</a> : <p className="dashboard-empty">No current robot has been added for team {teamNumber}.</p>}
					</section>
					<section className="dashboard-tile dashboard-score-tile" aria-labelledby="dashboard-score-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">Season performance</p><h2 id="dashboard-score-title">Team score trend</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team performance" title="Open team performance">↗</a></header>
						{team ? <ScoreTrendChart league={league} teams={[{ teamNumber, events: team.performanceByEvent }]} /> : <p className="dashboard-empty">Team performance is unavailable.</p>}
					</section>
					<section className="dashboard-tile dashboard-matches-tile" aria-labelledby="dashboard-matches-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">{scheduleEvent?.name || "Event schedule"}</p><h2 id="dashboard-matches-title">Your next match</h2></div>{scheduleEvent && <a href={eventHref(scheduleEvent, league, teamNumber, nextMatch?.matchKey)} aria-label="Open match notes" title="Open match notes">↗</a>}</header>
						{isLoadingSchedule ? <p className="dashboard-empty" aria-busy="true">Loading the next matchup...</p> : scheduleError ? <p className="dashboard-empty">{scheduleError}</p> : nextMatch ? <>
							<a className="dashboard-next-match-link" href={eventHref(scheduleEvent!, league, teamNumber, nextMatch.matchKey)}><strong>Qualification {nextMatch.qualificationNumber}</strong><time>{matchTime({ scheduledTime: nextMatch.scheduledTime })?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "Time TBD"}</time></a>
							<p className="dashboard-match-alliance"><span>With</span>{allianceTeams.filter((number) => number !== teamNumber).length ? allianceTeams.filter((number) => number !== teamNumber).map((number) => <a key={number} href={`/home?${new URLSearchParams({ team: number, league, season })}`}>{number}</a>) : <small>Alliance not listed</small>}</p>
							<p className="dashboard-match-alliance opposing"><span>Against</span>{opposingTeams.length ? opposingTeams.map((number) => <a key={number} href={`/home?${new URLSearchParams({ team: number, league, season })}`}>{number}</a>) : <small>Alliance not listed</small>}</p>
							<div className="dashboard-match-forecast"><strong>{winProbability === null ? "—" : `${Math.round(winProbability * 100)}%`}</strong><span>estimated win chance</span>
								{nextMatch.prediction.redScore !== null && nextMatch.prediction.blueScore !== null && <small>Projected score: {isRedAlliance ? nextMatch.prediction.redScore : nextMatch.prediction.blueScore} - {isRedAlliance ? nextMatch.prediction.blueScore : nextMatch.prediction.redScore}</small>}
							</div>
						</> : <p className="dashboard-empty">{scheduleEvent ? "No upcoming qualification is listed for your team." : "No current or recent event is available."}</p>}
					</section>
					<section className="dashboard-tile dashboard-shortcuts-tile" aria-labelledby="dashboard-shortcuts-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">Personal links</p><h2 id="dashboard-shortcuts-title">Shortcuts</h2></div><button className="dashboard-add-shortcut" type="button" title="Add shortcut" aria-label="Add shortcut" aria-expanded={showShortcutForm} onClick={() => setShowShortcutForm((current) => !current)}><span aria-hidden="true">+</span></button></header>
						{showShortcutForm && <form className="dashboard-shortcut-form" onSubmit={(event) => void addShortcut(event)}>
							<label>Destination<select value={shortcutKind} onChange={(event) => setShortcutKind(event.target.value as ShortcutKind)}><option value="event">Event page</option><option value="team">Team page</option><option value="comparison">Team comparison</option></select></label>
							<label>Label<input value={shortcutLabel} onChange={(event) => setShortcutLabel(event.target.value)} maxLength={100} placeholder="Optional label" /></label>
							{shortcutKind !== "event" && <label>Team number<input value={shortcutTeam} onChange={(event) => setShortcutTeam(event.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={6} required /></label>}
							{shortcutKind === "event" && <label>Event code<input value={shortcutEvent} onChange={(event) => setShortcutEvent(event.target.value)} maxLength={120} required /></label>}
							<div className="dashboard-shortcut-fields"><label>Program<select value={shortcutLeague} onChange={(event) => setShortcutLeague(event.target.value as League)}><option value="FTC">FTC</option><option value="FRC">FRC</option></select></label><label>Season<input value={shortcutSeason} onChange={(event) => setShortcutSeason(event.target.value)} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required /></label></div>
							<button className="search-button" type="submit" disabled={savingShortcut || personal.shortcuts.length >= 12}>{savingShortcut ? "Saving..." : "Add shortcut"}</button>
						</form>}
						{personal.shortcuts.length ? <ul className="dashboard-shortcut-list">{personal.shortcuts.map((shortcut) => <li key={shortcut.id}><a href={shortcutHref(shortcut)}><span>{shortcut.label}</span><small>{shortcut.kind}</small></a><button type="button" onClick={() => void removeShortcut(shortcut.id)} disabled={savingShortcut} aria-label={`Remove ${shortcut.label}`} title="Remove shortcut">×</button></li>)}</ul> : <p className="dashboard-empty">Add event, team, or comparison links for quick access.</p>}
					</section>
				</div>}
			</div>
		</main>
	);
}
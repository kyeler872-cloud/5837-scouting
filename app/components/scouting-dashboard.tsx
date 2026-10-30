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
type PersonalSettings = {
	teamNumber: 5837;
	ftcTeamNumber: 7247 | 5445;
	teamPreset: "SLB" | "FTC";
	theme: "dark" | "light";
	shortcuts: DashboardShortcut[];
};
type ContributorSession = { required: boolean; name: string | null; expiresAt: string | null };
type TeamData = {
	teamNumber: string;
	events: RecordValue | RecordValue[] | null;
	performanceByEvent: EventPerformance[];
	performance: { auto: { average: string | null; matchCount: number }; teleop: { average: string | null; matchCount: number } };
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

function scheduleEventFor(events: EventLink[]) {
	const upcomingEvents = events.filter((event) => !event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10));
	return activeEvent(events) || upcomingEvents[0] || events.at(-1) || null;
}

function nextScheduledMatch(matches: ScheduleMatch[], teamNumber: string) {
	return matches.find((match) =>
		!match.completed && match.teams.includes(teamNumber) &&
		(!match.scheduledTime || (matchTime({ scheduledTime: match.scheduledTime })?.getTime() || 0) >= Date.now()),
	) || matches.find((match) => !match.completed && match.teams.includes(teamNumber)) || null;
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
	const [personal, setPersonal] = useState<PersonalSettings>({ teamNumber: 5837, ftcTeamNumber: 7247, teamPreset: "SLB", theme: "dark", shortcuts: [] });
	const [team, setTeam] = useState<TeamData | null>(null);
	const [frcTeam, setFrcTeam] = useState<TeamData | null>(null);
	const [secondFtcTeam, setSecondFtcTeam] = useState<TeamData | null>(null);
	const [secondFtcTeamError, setSecondFtcTeamError] = useState("");
	const [schedule, setSchedule] = useState<EventSchedule | null>(null);
	const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
	const [scheduleError, setScheduleError] = useState("");
	const [secondFtcSchedule, setSecondFtcSchedule] = useState<EventSchedule | null>(null);
	const [isLoadingSecondFtcSchedule, setIsLoadingSecondFtcSchedule] = useState(false);
	const [secondFtcScheduleError, setSecondFtcScheduleError] = useState("");
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
				const number = String(settingsData.personal.ftcTeamNumber);
				const teamResponseUrl = `/api/teams/${encodeURIComponent(number)}?${new URLSearchParams({ league: "ftc", season })}`;
				const frcTeamResponseUrl = `/api/teams/5837?${new URLSearchParams({ league: "frc", season })}`;
				const secondFtcTeamResponseUrl = `/api/teams/5445?${new URLSearchParams({ league: "ftc", season })}`;
				const [teamResponse, frcTeamResponse, secondFtcTeamResult] = await Promise.all([
					fetch(teamResponseUrl, { headers }),
					settingsData.personal.teamPreset === "SLB" ? fetch(frcTeamResponseUrl, { headers }) : Promise.resolve(null),
					settingsData.personal.teamPreset === "SLB"
						? fetch(secondFtcTeamResponseUrl, { headers })
							.then((response) => ({ response }))
							.catch((requestError: unknown) => ({ error: requestError instanceof Error ? requestError.message : "Could not load FTC team 5445." }))
						: Promise.resolve(null),
				]);
				const teamData = await readResponse<TeamData | { error?: string }>(teamResponse);
				if (!teamResponse.ok) throw new Error("error" in teamData ? teamData.error || "Could not load your FTC team." : "Could not load your FTC team.");
				let frcTeamData: TeamData | null = null;
				let secondFtcTeamData: TeamData | null = null;
				let secondFtcLoadError = "";
				if (frcTeamResponse) {
					const frcData = await readResponse<TeamData | { error?: string }>(frcTeamResponse);
					if (!frcTeamResponse.ok) throw new Error("error" in frcData ? frcData.error || "Could not load FRC team 5837." : "Could not load FRC team 5837.");
					frcTeamData = frcData as TeamData;
				}
				if (secondFtcTeamResult) {
					if ("error" in secondFtcTeamResult) {
						secondFtcLoadError = secondFtcTeamResult.error;
					} else {
						try {
							const secondFtcData = await readResponse<TeamData | { error?: string }>(secondFtcTeamResult.response);
							if (!secondFtcTeamResult.response.ok) {
								secondFtcLoadError = "error" in secondFtcData ? secondFtcData.error || "Could not load FTC team 5445." : "Could not load FTC team 5445.";
							} else {
								secondFtcTeamData = secondFtcData as TeamData;
							}
						} catch (loadError) {
							secondFtcLoadError = loadError instanceof Error ? loadError.message : "Could not load FTC team 5445.";
						}
					}
				}
				if (!cancelled) {
					setTeam(teamData as TeamData);
					setFrcTeam(frcTeamData);
					setSecondFtcTeam(secondFtcTeamData);
					setSecondFtcTeamError(secondFtcLoadError);
				}
			} catch (loadError) {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the dashboard.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [getToken]);

	const teamNumber = String(personal.ftcTeamNumber);
	const league: League = "FTC";
	const events = team ? eventRecords(team, league) : [];
	const frcEvents = frcTeam ? eventRecords(frcTeam, "FRC") : [];
	const currentRobots = team?.robots.filter((robot) => !robot.endMonth) || [];
	const frcCurrentRobot = frcTeam?.robots.find((robot) => !robot.endMonth) || null;
	const secondFtcEvents = secondFtcTeam ? eventRecords(secondFtcTeam, "FTC") : [];
	const secondFtcUpcomingEvents = secondFtcEvents.filter((event) =>
		!event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10),
	).slice(0, 5);
	const secondFtcCurrentRobot = secondFtcTeam?.robots.find((robot) => !robot.endMonth) || null;
	const currentEvent = activeEvent(events);
	const upcomingEvents = events.filter((event) => !event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10)).slice(0, 5);
	const scheduleEvent = currentEvent || upcomingEvents[0] || events.at(-1) || null;
	const secondFtcScheduleEvent = scheduleEventFor(secondFtcEvents);
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
	const secondFtcNextMatch = nextScheduledMatch(secondFtcSchedule?.matches || [], "5445");
	const secondFtcIsRedAlliance = secondFtcNextMatch?.redTeams.includes("5445") || false;
	const secondFtcAllianceTeams = secondFtcIsRedAlliance ? secondFtcNextMatch?.redTeams || [] : secondFtcNextMatch?.blueTeams || [];
	const secondFtcOpposingTeams = secondFtcIsRedAlliance ? secondFtcNextMatch?.blueTeams || [] : secondFtcNextMatch?.redTeams || [];
	const secondFtcWinProbability = secondFtcNextMatch?.prediction.redWinProbability == null
		? null
		: secondFtcIsRedAlliance ? secondFtcNextMatch.prediction.redWinProbability : 1 - secondFtcNextMatch.prediction.redWinProbability;

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

	useEffect(() => {
		let cancelled = false;
		setSecondFtcSchedule(null);
		setSecondFtcScheduleError("");
		if (personal.teamPreset !== "SLB" || !secondFtcScheduleEvent) {
			setIsLoadingSecondFtcSchedule(false);
			return () => { cancelled = true; };
		}
		setIsLoadingSecondFtcSchedule(true);
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch(`/api/events/FTC/${encodeURIComponent(season)}/${encodeURIComponent(secondFtcScheduleEvent.code)}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<EventSchedule | { error?: string }>(response);
				if (!response.ok) throw new Error("error" in data ? data.error || "Could not load the event schedule for FTC 5445." : "Could not load the event schedule for FTC 5445.");
				if (!cancelled) setSecondFtcSchedule(data as EventSchedule);
			} catch (loadError) {
				if (!cancelled) setSecondFtcScheduleError(loadError instanceof Error ? loadError.message : "Could not load the event schedule for FTC 5445.");
			} finally {
				if (!cancelled) setIsLoadingSecondFtcSchedule(false);
			}
		})();
		return () => { cancelled = true; };
	}, [getToken, personal.teamPreset, secondFtcScheduleEvent?.code]);

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
					<div><p className="section-kicker">{personal.teamPreset === "SLB" ? "FRC 5837 + FTC 7247 + FTC 5445" : `${league} ${teamNumber}`} · {season}-{String(Number(season) + 1).slice(-2)} season</p><h1>Welcome, {contributor.required ? contributor.name || "iPad" : user?.username || user?.firstName || "scout"}</h1></div>
					<div className="dashboard-heading-actions">
						<a className="dashboard-team-link" href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`}>Team {teamNumber}<span aria-hidden="true">↗</span></a>
						{personal.teamPreset === "SLB" && <a className="dashboard-team-link" href={`/home?${new URLSearchParams({ team: "5837", league: "FRC", season })}`}>FRC 5837<span aria-hidden="true">↗</span></a>}
						{personal.teamPreset === "SLB" && <a className="dashboard-team-link" href={`/home?${new URLSearchParams({ team: "5445", league: "FTC", season })}`}>FTC 5445<span aria-hidden="true">↗</span></a>}
					</div>
				</header>
				{error && <p className="lookup-error" role="alert">{error}</p>}
				{loading ? <p className="dashboard-status" aria-busy="true">Loading your team dashboard...</p> : <div className="dashboard-grid">
					<section className="dashboard-tile dashboard-events-tile" aria-labelledby="dashboard-events-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-events-title">Events</h2></div><a href="/events" aria-label="Browse events" title="Browse events">↗</a></header>
						{upcomingEvents.length ? <ul className="dashboard-event-list">{upcomingEvents.map((event) => <li key={event.code}>
							<a href={eventHref(event, league, teamNumber)}><span><strong>{event.name}</strong>{event.code === currentEvent?.code && <em>Live</em>}</span><small>{dateLabel(event.start, event.end)}</small></a>
						</li>)}</ul> : <p className="dashboard-empty">No events are listed for this team yet.</p>}
					</section>
					<section className="dashboard-tile dashboard-robot-tile" aria-labelledby="dashboard-robot-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-robot-title">Current robot</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team profile" title="Open team profile">↗</a></header>
						{currentRobots[0] ? <a className="dashboard-robot" href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`}>
							{currentRobots[0].imageUrls[0] && <img src={currentRobots[0].imageUrls[0].url} alt="" />}
							<div><strong>{currentRobots[0].name || "Current robot"}</strong><p>{currentRobots[0].description || "Open the team profile to see the robot details."}</p></div>
						</a> : <p className="dashboard-empty">No robot added yet.</p>}
					</section>
					{personal.teamPreset === "SLB" && <>
						<section className="dashboard-tile dashboard-events-tile" aria-labelledby="dashboard-second-ftc-events-title">
							<header className="dashboard-tile-heading"><div><h2 id="dashboard-second-ftc-events-title">FTC 5445 events</h2></div><a href="/events" aria-label="Browse FTC events" title="Browse FTC events">↗</a></header>
							{secondFtcUpcomingEvents.length ? <ul className="dashboard-event-list">{secondFtcUpcomingEvents.map((event) => <li key={event.code}>
								<a href={eventHref(event, "FTC", "5445")}><span><strong>{event.name}</strong></span><small>{dateLabel(event.start, event.end)}</small></a>
							</li>)}</ul> : <p className="dashboard-empty">{secondFtcTeamError || "No upcoming events are listed for FTC 5445."}</p>}
						</section>
						<section className="dashboard-tile dashboard-robot-tile" aria-labelledby="dashboard-second-ftc-robot-title">
							<header className="dashboard-tile-heading"><div><h2 id="dashboard-second-ftc-robot-title">FTC 5445 current robot</h2></div><a href={`/home?${new URLSearchParams({ team: "5445", league: "FTC", season })}`} aria-label="Open FTC team 5445 profile" title="Open FTC team 5445 profile">↗</a></header>
							{secondFtcCurrentRobot ? <a className="dashboard-robot" href={`/home?${new URLSearchParams({ team: "5445", league: "FTC", season })}`}>
								{secondFtcCurrentRobot.imageUrls[0] && <img src={secondFtcCurrentRobot.imageUrls[0].url} alt="" />}
								<div><strong>{secondFtcCurrentRobot.name || "Current robot"}</strong><p>{secondFtcCurrentRobot.description || "Open the team profile for details."}</p></div>
							</a> : <p className="dashboard-empty">{secondFtcTeamError || "No robot added for FTC 5445 yet."}</p>}
						</section>
					</>}
					<section className="dashboard-tile dashboard-score-tile" aria-labelledby="dashboard-score-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-score-title">Score trend</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team performance" title="Open team performance">↗</a></header>
						{team ? <ScoreTrendChart league={league} teams={[{ teamNumber, events: team.performanceByEvent }]} /> : <p className="dashboard-empty">Team performance is unavailable.</p>}
					</section>
					<section className="dashboard-tile dashboard-matches-tile" aria-labelledby="dashboard-matches-title">
						<header className="dashboard-tile-heading"><div><p className="section-kicker">FTC {teamNumber}{scheduleEvent?.name ? ` · ${scheduleEvent.name}` : ""}</p><h2 id="dashboard-matches-title">Next match</h2></div>{scheduleEvent && <a href={eventHref(scheduleEvent, league, teamNumber, nextMatch?.matchKey)} aria-label={`Open FTC ${teamNumber} match notes`} title={`Open FTC ${teamNumber} match notes`}>↗</a>}</header>
						{isLoadingSchedule ? <p className="dashboard-empty" aria-busy="true">Loading the next matchup...</p> : scheduleError ? <p className="dashboard-empty">{scheduleError}</p> : nextMatch ? <>
							<a className="dashboard-next-match-link" href={eventHref(scheduleEvent!, league, teamNumber, nextMatch.matchKey)}><strong>Qualification {nextMatch.qualificationNumber}</strong><time>{matchTime({ scheduledTime: nextMatch.scheduledTime })?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "Time TBD"}</time></a>
							<p className="dashboard-match-alliance"><span>With</span>{allianceTeams.filter((number) => number !== teamNumber).length ? allianceTeams.filter((number) => number !== teamNumber).map((number) => <a key={number} href={`/home?${new URLSearchParams({ team: number, league, season })}`}>{number}</a>) : <small>Alliance not listed</small>}</p>
							<p className="dashboard-match-alliance opposing"><span>Against</span>{opposingTeams.length ? opposingTeams.map((number) => <a key={number} href={`/home?${new URLSearchParams({ team: number, league, season })}`}>{number}</a>) : <small>Alliance not listed</small>}</p>
							<div className="dashboard-match-forecast"><strong>{winProbability === null ? "—" : `${Math.round(winProbability * 100)}%`}</strong><span>Win chance</span>
								{nextMatch.prediction.redScore !== null && nextMatch.prediction.blueScore !== null && <small>Projected score: {isRedAlliance ? nextMatch.prediction.redScore : nextMatch.prediction.blueScore} - {isRedAlliance ? nextMatch.prediction.blueScore : nextMatch.prediction.redScore}</small>}
							</div>
						</> : <p className="dashboard-empty">{scheduleEvent ? "No upcoming qualification is listed for your team." : "No current or recent event is available."}</p>}
						{personal.teamPreset === "SLB" && <div className="dashboard-second-team-match">
							<header><p className="section-kicker">FTC 5445 · {secondFtcScheduleEvent?.name || "Event schedule"}</p><h3>Team 5445 next match</h3></header>
							{isLoadingSecondFtcSchedule ? <p className="dashboard-empty" aria-busy="true">Loading FTC 5445's next matchup...</p>
								: secondFtcTeamError ? <p className="dashboard-empty" role="alert">{secondFtcTeamError}</p>
									: secondFtcScheduleError ? <p className="dashboard-empty" role="alert">{secondFtcScheduleError}</p>
									: secondFtcNextMatch && secondFtcScheduleEvent ? <>
										<a className="dashboard-next-match-link" href={eventHref(secondFtcScheduleEvent, "FTC", "5445", secondFtcNextMatch.matchKey)}>
											<strong>Qualification {secondFtcNextMatch.qualificationNumber}</strong>
											<time>{matchTime({ scheduledTime: secondFtcNextMatch.scheduledTime })?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "Time TBD"}</time>
										</a>
										<p className="dashboard-match-alliance"><span>With</span>{secondFtcAllianceTeams.filter((number) => number !== "5445").length
											? secondFtcAllianceTeams.filter((number) => number !== "5445").map((number) => <a key={number} href={"/home?" + new URLSearchParams({ team: number, league: "FTC", season })}>{number}</a>)
											: <small>Alliance not listed</small>}</p>
										<p className="dashboard-match-alliance opposing"><span>Against</span>{secondFtcOpposingTeams.length
											? secondFtcOpposingTeams.map((number) => <a key={number} href={"/home?" + new URLSearchParams({ team: number, league: "FTC", season })}>{number}</a>)
											: <small>Alliance not listed</small>}</p>
										<div className="dashboard-match-forecast"><strong>{secondFtcWinProbability === null ? "—" : `${Math.round(secondFtcWinProbability * 100)}%`}</strong><span>Win chance</span>
											{secondFtcNextMatch.prediction.redScore !== null && secondFtcNextMatch.prediction.blueScore !== null && <small>Projected score: {secondFtcIsRedAlliance ? secondFtcNextMatch.prediction.redScore : secondFtcNextMatch.prediction.blueScore} - {secondFtcIsRedAlliance ? secondFtcNextMatch.prediction.blueScore : secondFtcNextMatch.prediction.redScore}</small>}
										</div>
									</> : <p className="dashboard-empty">{secondFtcScheduleEvent ? "No upcoming qualification is listed for FTC 5445." : "No current or upcoming FTC event is listed for team 5445."}</p>}
						</div>}
					</section>
					<section className="dashboard-tile dashboard-shortcuts-tile" aria-labelledby="dashboard-shortcuts-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-shortcuts-title">Shortcuts</h2></div><button className="dashboard-add-shortcut" type="button" title="Add shortcut" aria-label="Add shortcut" aria-expanded={showShortcutForm} onClick={() => setShowShortcutForm((current) => !current)}><span aria-hidden="true">+</span></button></header>
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
					{personal.teamPreset === "SLB" && <section className="dashboard-tile dashboard-frc-profile-tile" aria-labelledby="dashboard-frc-profile-title">
						<header className="dashboard-tile-heading">
							<div><p className="section-kicker">FRC · Team 5837</p><h2 id="dashboard-frc-profile-title">FRC team profile</h2></div>
							<a href={`/home?${new URLSearchParams({ team: "5837", league: "FRC", season })}`} aria-label="Open FRC team 5837 profile" title="Open FRC team 5837 profile">↗</a>
						</header>
						<div className="dashboard-frc-profile-content">
							<div>
								<strong>Robot</strong>
								<p className="dashboard-frc-robot-name">{frcCurrentRobot?.name || "Not listed"}</p>
								{frcCurrentRobot?.description && <p className="dashboard-frc-robot-description">{frcCurrentRobot.description}</p>}
								<strong>Average score</strong>
								<div className="dashboard-frc-averages">
									<p><span>TeleOp</span><strong>{frcTeam?.performance.teleop.average ?? "—"}</strong><small>{frcTeam?.performance.teleop.matchCount ?? 0} matches</small></p>
									<p><span>Auto</span><strong>{frcTeam?.performance.auto.average ?? "—"}</strong><small>{frcTeam?.performance.auto.matchCount ?? 0} matches</small></p>
								</div>
							</div>
							<div>
								<strong>Events</strong>
								{frcEvents.length ? <ul className="dashboard-event-list">{frcEvents.slice(0, 4).map((event) => <li key={event.code}>
									<a href={eventHref(event, "FRC", "5837")}><span><strong>{event.name}</strong></span><small>{dateLabel(event.start, event.end)}</small></a>
								</li>)}</ul> : <p className="dashboard-empty">No events are listed for this team yet.</p>}
							</div>
						</div>
						{frcTeam && <ScoreTrendChart league="FRC" teams={[{ teamNumber: "5837", events: frcTeam.performanceByEvent }]} />}
					</section>}
				</div>}
			</div>
		</main>
	);
}
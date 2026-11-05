import { useAuth, useUser } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { ScoreTrendChart, type EventPerformance } from "./score-trend-chart";
import { TopNavigation } from "./top-navigation";
import { saveContributorName as saveLocalContributorName } from "../contributor.client";
import { readRecentPages, subscribeToRecentPages, type RecentPage } from "../recent-pages.client";

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
	primaryLeague: League;
	primaryTeamNumber: string;
	organizationTeams: { league: League; teamNumber: string }[];
	theme: "dark" | "light";
	shortcuts: DashboardShortcut[];
};
type ContributorSession = { required: boolean; kiosk: boolean; name: string | null; expiresAt: string | null };
type TeamData = {
	teamNumber: string;
	events: RecordValue | RecordValue[] | null;
	performanceByEvent: EventPerformance[];
	performance: { auto: { average: string | null; matchCount: number }; teleop: { average: string | null; matchCount: number } };
	robots: { id: string; name: string; description: string; imageUrls: { url: string }[]; endMonth: string | null }[];
	customEvents: { code: string; name: string; date: string | null }[];
};
type EventLink = { code: string; name: string; start: string | null; end: string | null; custom?: boolean };
type DashboardEvent = EventLink & { league: League; teamNumbers: string[] };
type ScheduleMatch = {
	matchKey: string;
	qualificationNumber: number;
	teams: string[];
	redTeams: string[];
	blueTeams: string[];
	scheduledTime: string | null;
	completed: boolean;
	redScore: number | null;
	blueScore: number | null;
	prediction: { redScore: number | null; blueScore: number | null; redWinProbability: number | null };
};
type EventSchedule = { matches: ScheduleMatch[] };
type LatestMatchResult = { event: EventLink; match: ScheduleMatch };
type LatestMatchResults = { results: LatestMatchResult[]; error: string };
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

function latestCompletedMatches(matches: ScheduleMatch[], teamNumber: string) {
	return matches.filter((match) =>
		match.completed && match.redScore !== null && match.blueScore !== null && match.teams.includes(teamNumber),
	).slice(-2).reverse();
}

async function fetchLatestResults(events: EventLink[], teamNumber: string, league: League, getToken: () => Promise<string | null>): Promise<LatestMatchResults> {
	const token = await getToken();
	const results: LatestMatchResult[] = [];
	let lastError = "";
	const recentEvents = events.filter((event) => !event.custom)
		.sort((first, second) => (first.end || first.start || "0000").localeCompare(second.end || second.start || "0000"))
		.reverse();
	for (const event of recentEvents) {
		try {
			const response = await fetch(`/api/events/${league}/${encodeURIComponent(season)}/${encodeURIComponent(event.code)}`, {
				headers: token ? { Authorization: ["Bearer", token].join(" ") } : undefined,
			});
			const data = await readResponse<EventSchedule | { error?: string }>(response);
			if (!response.ok) throw new Error("error" in data ? data.error || "Could not load event results." : "Could not load event results.");
			if (!("matches" in data) || !Array.isArray(data.matches)) throw new Error("Event results response did not include a match list.");
			results.push(...latestCompletedMatches(data.matches, teamNumber).map((match) => ({ event, match })));
			if (results.length >= 2) break;
		} catch (loadError) {
			lastError = loadError instanceof Error ? loadError.message : "Could not load event results.";
		}
	}
	return { results: results.slice(0, 2), error: results.length ? "" : lastError };
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
	const [personal, setPersonal] = useState<PersonalSettings>({
		teamNumber: 5837, ftcTeamNumber: 7247, teamPreset: "SLB", primaryLeague: "FTC", primaryTeamNumber: "7247",
		organizationTeams: [], theme: "dark", shortcuts: [],
	});
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
	const [latestResults, setLatestResults] = useState<LatestMatchResults>({ results: [], error: "" });
	const [isLoadingLatestResults, setIsLoadingLatestResults] = useState(false);
	const [secondFtcLatestResults, setSecondFtcLatestResults] = useState<LatestMatchResults>({ results: [], error: "" });
	const [isLoadingSecondFtcLatestResults, setIsLoadingSecondFtcLatestResults] = useState(false);
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
	const [contributor, setContributor] = useState<ContributorSession>({ required: false, kiosk: false, name: null, expiresAt: null });
	const [showContributorEditor, setShowContributorEditor] = useState(false);
	const [contributorDraft, setContributorDraft] = useState("");
	const [savingContributor, setSavingContributor] = useState(false);
	const [recentPages, setRecentPages] = useState<RecentPage[]>([]);

	useEffect(() => {
		const updateRecentPages = () => setRecentPages(readRecentPages());
		updateRecentPages();
		return subscribeToRecentPages(updateRecentPages);
	}, []);

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
				const number = settingsData.personal.primaryTeamNumber;
				const teamResponseUrl = `/api/teams/${encodeURIComponent(number)}?${new URLSearchParams({ league: settingsData.personal.primaryLeague.toLowerCase(), season })}`;
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

	const teamNumber = personal.primaryTeamNumber;
	const league = personal.primaryLeague;
	const events = team ? eventRecords(team, league) : [];
	const frcEvents = frcTeam ? eventRecords(frcTeam, "FRC") : [];
	const currentRobots = team?.robots.filter((robot) => !robot.endMonth) || [];
	const frcCurrentRobot = frcTeam?.robots.find((robot) => !robot.endMonth) || null;
	const secondFtcEvents = secondFtcTeam ? eventRecords(secondFtcTeam, "FTC") : [];
	const secondFtcCurrentRobot = secondFtcTeam?.robots.find((robot) => !robot.endMonth) || null;
	const currentEvent = activeEvent(events);
	const upcomingEvents = events.filter((event) => !event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10)).slice(0, 5);
	const dashboardEvents = [
		...events.map((event) => ({ ...event, league, teamNumbers: [teamNumber] })),
		...(personal.teamPreset === "SLB"
			? secondFtcEvents.map((event) => ({ ...event, league: "FTC" as const, teamNumbers: ["5445"] }))
			: []),
		...(personal.teamPreset === "SLB"
			? frcEvents.map((event) => ({ ...event, league: "FRC" as const, teamNumbers: ["5837"] }))
			: []),
	].filter((event) => !event.end || event.end.slice(0, 10) >= new Date().toISOString().slice(0, 10))
		.reduce<DashboardEvent[]>((combined, event) => {
			const existing = combined.find((item) => item.league === event.league && item.code === event.code);
			if (existing) {
				existing.teamNumbers = [...new Set([...existing.teamNumbers, ...event.teamNumbers])];
			} else {
				combined.push(event);
			}
			return combined;
		}, [])
		.sort((first, second) => (first.start || "9999").localeCompare(second.start || "9999"))
		.slice(0, 10);
	const scheduleEvent = currentEvent || upcomingEvents[0] || events.at(-1) || null;
	const secondFtcScheduleEvent = scheduleEventFor(secondFtcEvents);
	const nextMatch = schedule?.matches.find((match) =>
		!match.completed && match.teams.includes(teamNumber) && (!match.scheduledTime || (matchTime({ scheduledTime: match.scheduledTime })?.getTime() || 0) >= Date.now()),
	) || schedule?.matches.find((match) => !match.completed && match.teams.includes(teamNumber)) || null;
	const isRedAlliance = nextMatch?.redTeams.includes(teamNumber) || false;
	const winProbability = nextMatch?.prediction.redWinProbability === null || nextMatch?.prediction.redWinProbability === undefined
		? null
		: isRedAlliance ? nextMatch.prediction.redWinProbability : 1 - nextMatch.prediction.redWinProbability;
	const secondFtcNextMatch = nextScheduledMatch(secondFtcSchedule?.matches || [], "5445");
	const secondFtcIsRedAlliance = secondFtcNextMatch?.redTeams.includes("5445") || false;
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
		setLatestResults({ results: [], error: "" });
		if (!team) {
			setIsLoadingLatestResults(false);
			return () => { cancelled = true; };
		}
		setIsLoadingLatestResults(true);
		void fetchLatestResults(eventRecords(team, league), teamNumber, league, getToken)
			.then((result) => { if (!cancelled) setLatestResults(result); })
			.catch((loadError: unknown) => {
				if (!cancelled) setLatestResults({ results: [], error: loadError instanceof Error ? loadError.message : "Could not load latest results." });
			})
			.finally(() => { if (!cancelled) setIsLoadingLatestResults(false); });
		return () => { cancelled = true; };
	}, [getToken, league, team, teamNumber]);

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

	useEffect(() => {
		let cancelled = false;
		setSecondFtcLatestResults({ results: [], error: "" });
		if (personal.teamPreset !== "SLB" || !secondFtcTeam) {
			setIsLoadingSecondFtcLatestResults(false);
			return () => { cancelled = true; };
		}
		setIsLoadingSecondFtcLatestResults(true);
		void fetchLatestResults(eventRecords(secondFtcTeam, "FTC"), "5445", "FTC", getToken)
			.then((result) => { if (!cancelled) setSecondFtcLatestResults(result); })
			.catch((loadError: unknown) => {
				if (!cancelled) setSecondFtcLatestResults({ results: [], error: loadError instanceof Error ? loadError.message : "Could not load FTC 5445's latest results." });
			})
			.finally(() => { if (!cancelled) setIsLoadingSecondFtcLatestResults(false); });
		return () => { cancelled = true; };
	}, [getToken, personal.teamPreset, secondFtcTeam]);

	async function saveContributorName(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSavingContributor(true);
		setError("");
		try {
			const token = await getToken();
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
				body: JSON.stringify({ action: "contributor-name", contributorName: contributorDraft }),
			});
			const data = await readResponse<{ contributor?: ContributorSession; error?: string }>(response);
			if (!response.ok || !data.contributor) throw new Error(data.error || "Could not save your credited name.");
			const name = saveLocalContributorName(data.contributor.name, data.contributor.kiosk ? 3600 : 31_536_000, data.contributor.expiresAt ? Date.parse(data.contributor.expiresAt) : undefined);
			setContributor(data.contributor);
			setContributorDraft(name);
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
					<div><p className="section-kicker">{contributor.kiosk ? "Team kiosk · assigned to all organization teams" : personal.teamPreset === "SLB" ? "FRC 5837 + FTC 7247 + FTC 5445" : `${league} ${teamNumber}`} · {season}-{String(Number(season) + 1).slice(-2)} season</p><h1>Welcome, {contributor.required ? contributor.name || "scout" : user?.username || user?.firstName || "scout"}</h1>
						{contributor.required && <button className="dashboard-contributor-edit" type="button" aria-expanded={showContributorEditor} onClick={() => setShowContributorEditor((current) => !current)}>{showContributorEditor ? "Cancel name change" : contributor.kiosk ? "Change user name" : "Change iPad name"}</button>}
					</div>
					<div className="dashboard-heading-actions">
						{personal.organizationTeams.map((organizationTeam) => <a className="dashboard-team-link" href={`/home?${new URLSearchParams({ team: organizationTeam.teamNumber, league: organizationTeam.league, season })}`} key={`${organizationTeam.league}:${organizationTeam.teamNumber}`}>
							{organizationTeam.league} {organizationTeam.teamNumber}<span aria-hidden="true">↗</span>
						</a>)}
					</div>
				</header>
				{showContributorEditor && <form className="dashboard-contributor-form" onSubmit={(event) => void saveContributorName(event)}>
					<label htmlFor="dashboard-contributor-name">{contributor.kiosk ? "Name credited for the next hour" : "Name credited for this device"}</label>
					<input id="dashboard-contributor-name" value={contributorDraft} onChange={(event) => setContributorDraft(event.target.value)} maxLength={80} autoComplete="name" required />
					<button className="search-button" type="submit" disabled={savingContributor || !contributorDraft.trim()}>{savingContributor ? "Saving..." : contributor.kiosk ? "Save user name" : "Save iPad name"}</button>
				</form>}
				{error && <p className="lookup-error" role="alert">{error}</p>}
				{loading ? <p className="dashboard-status" aria-busy="true">Loading your team dashboard...</p> : <div className="dashboard-grid">
					<section className="dashboard-tile dashboard-events-tile" aria-labelledby="dashboard-events-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-events-title">Upcoming events</h2></div><a href="/events" aria-label="Browse events" title="Browse events">↗</a></header>
						{dashboardEvents.length ? <ul className="dashboard-event-list">{dashboardEvents.map((event) => <li key={`${event.league}-${event.code}`}>
							<a href={eventHref(event, event.league, event.teamNumbers[0])}>
								<span><strong>{event.name}</strong>{activeEvent([event]) && <em>Live</em>}<small className="dashboard-event-team">Team{event.teamNumbers.length > 1 ? "s" : ""} {event.teamNumbers.join(", ")} · {event.league}</small></span>
								<small>{dateLabel(event.start, event.end)}</small>
							</a>
						</li>)}</ul> : <p className="dashboard-empty">No upcoming events are listed for your teams.</p>}
						{personal.teamPreset === "SLB" && secondFtcTeamError && <p className="dashboard-empty" role="status">FTC 5445 events unavailable: {secondFtcTeamError}</p>}
					</section>
					<section className="dashboard-tile dashboard-robot-tile" aria-labelledby="dashboard-robot-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-robot-title">{personal.teamPreset === "SLB" ? "Current robots" : "Current robot"}</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team profile" title="Open team profile">↗</a></header>
						{personal.teamPreset === "SLB" ? <div className="dashboard-current-robots">
							{[
								{ teamNumber, robot: currentRobots[0] || null, error: "" },
								{ teamNumber: "5445", robot: secondFtcCurrentRobot, error: secondFtcTeamError },
							].map(({ teamNumber: robotTeamNumber, robot, error: robotError }) => <section className="dashboard-current-robot" key={robotTeamNumber}>
								<h3>FTC {robotTeamNumber}</h3>
								{robot ? <a className="dashboard-robot" href={`/home?${new URLSearchParams({ team: robotTeamNumber, league, season })}`}>
									{robot.imageUrls[0] && <img src={robot.imageUrls[0].url} alt="" />}
									<div><strong>{robot.name || "Current robot"}</strong>{robot.description && <p>{robot.description}</p>}</div>
								</a> : <p className="dashboard-empty">{robotError || "No robot added yet."}</p>}
							</section>)}
						</div> : currentRobots[0] ? <a className="dashboard-robot" href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`}>
							{currentRobots[0].imageUrls[0] && <img src={currentRobots[0].imageUrls[0].url} alt="" />}
							<div><strong>{currentRobots[0].name || "Current robot"}</strong><p>{currentRobots[0].description || "Open the team profile to see the robot details."}</p></div>
						</a> : <p className="dashboard-empty">No robot added yet.</p>}
					</section>
					<section className="dashboard-tile dashboard-score-tile" aria-labelledby="dashboard-score-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-score-title">Score trend</h2></div><a href={`/home?${new URLSearchParams({ team: teamNumber, league, season })}`} aria-label="Open team performance" title="Open team performance">↗</a></header>
						{team ? <ScoreTrendChart league={league} teams={[{ teamNumber, events: team.performanceByEvent }]} /> : <p className="dashboard-empty">Team performance is unavailable.</p>}
					</section>
					<section className="dashboard-tile dashboard-matches-tile" aria-labelledby="dashboard-matches-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-matches-title">Next matches</h2></div></header>
						{isLoadingSchedule ? <p className="dashboard-empty" aria-busy="true">Loading {league} {teamNumber}'s next match...</p>
							: scheduleError ? <p className="dashboard-empty">{scheduleError}</p>
								: nextMatch && scheduleEvent ? <NextMatchCard event={scheduleEvent} match={nextMatch} teamNumber={teamNumber} league={league} winProbability={winProbability} favoriteTeams={personal.teamPreset === "SLB" ? ["7247", "5445"] : [teamNumber]} />
									: <p className="dashboard-empty">{scheduleEvent ? `No upcoming qualification for ${league} ${teamNumber}.` : `No current or recent ${league} event is available.`}</p>}
						{personal.teamPreset === "SLB" && <div className="dashboard-second-team-match">
							{isLoadingSecondFtcSchedule ? <p className="dashboard-empty" aria-busy="true">Loading FTC 5445's next match...</p>
								: secondFtcTeamError ? <p className="dashboard-empty" role="alert">{secondFtcTeamError}</p>
									: secondFtcScheduleError ? <p className="dashboard-empty" role="alert">{secondFtcScheduleError}</p>
										: secondFtcNextMatch && secondFtcScheduleEvent
											? <NextMatchCard event={secondFtcScheduleEvent} match={secondFtcNextMatch} teamNumber="5445" league="FTC" winProbability={secondFtcWinProbability} favoriteTeams={["7247", "5445"]} />
											: <p className="dashboard-empty">{secondFtcScheduleEvent ? "No upcoming qualification for FTC 5445." : "No current or upcoming FTC event is listed for team 5445."}</p>}
						</div>}
					</section>
					<section className="dashboard-tile dashboard-results-tile" aria-labelledby="dashboard-results-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-results-title">Latest results</h2></div></header>
						<LatestMatchResults results={latestResults.results} teamNumber={teamNumber} league={league} isLoading={isLoadingLatestResults} error={latestResults.error} />
						{personal.teamPreset === "SLB" && <div className="dashboard-second-team-match">
							<LatestMatchResults results={secondFtcLatestResults.results} teamNumber="5445" league="FTC" isLoading={isLoadingSecondFtcLatestResults} error={secondFtcTeamError || secondFtcLatestResults.error} />
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
					<section className="dashboard-tile dashboard-recent-tile" aria-labelledby="dashboard-recent-title">
						<header className="dashboard-tile-heading"><div><h2 id="dashboard-recent-title">Recently visited</h2></div></header>
						{recentPages.length ? <ul className="dashboard-recent-list">{recentPages.map((page) => {
							const visitedAt = new Date(page.visitedAt);
							return <li key={page.href}>
								<a href={page.href}>
									<strong>{page.title}</strong>
									{page.detail && <span>{page.detail}</span>}
									<small>{Number.isNaN(visitedAt.getTime()) ? "" : visitedAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
								</a>
							</li>;
						})}</ul> : <p className="dashboard-empty">Pages you visit will appear here on this device.</p>}
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
						</div>
						{frcTeam && <ScoreTrendChart league="FRC" teams={[{ teamNumber: "5837", events: frcTeam.performanceByEvent }]} />}
					</section>}
				</div>}
			</div>
		</main>
	);
}

function NextMatchCard({ event, match, teamNumber, league, winProbability, favoriteTeams }: {
	event: EventLink;
	match: ScheduleMatch;
	teamNumber: string;
	league: League;
	winProbability: number | null;
	favoriteTeams: string[];
}) {
	const isRedAlliance = match.redTeams.includes(teamNumber);
	const scheduledTime = matchTime({ scheduledTime: match.scheduledTime });
	const projectedOwnScore = isRedAlliance ? match.prediction.redScore : match.prediction.blueScore;
	const projectedOpponentScore = isRedAlliance ? match.prediction.blueScore : match.prediction.redScore;

	function renderAllianceTeams(teams: string[]) {
		if (!teams.length) return <small>Teams unavailable</small>;
		return teams.map((number) => <a
			key={number}
			href={`/home?${new URLSearchParams({ team: number, league, season })}`}
			className={favoriteTeams.includes(number) ? "dashboard-match-team-featured" : undefined}
		>
			{favoriteTeams.includes(number) ? <strong>{number}</strong> : number}
		</a>);
	}

	return <article className="dashboard-next-match-card">
		<header className="dashboard-next-match-heading">
			<div><p className="section-kicker">{league} {teamNumber} · {event.name}</p>
				<a className="dashboard-next-match-link" href={eventHref(event, league, teamNumber, match.matchKey)}>
					<strong>Qualification {match.qualificationNumber}</strong>
					<time>{scheduledTime?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "Time TBD"}</time>
				</a>
			</div>
		</header>
		<div className="dashboard-match-alliances" aria-label={`Teams playing in qualification ${match.qualificationNumber}`}>
			<section className="dashboard-match-alliance-red"><h4>Red alliance</h4><div>{renderAllianceTeams(match.redTeams)}</div></section>
			<section className="dashboard-match-alliance-blue"><h4>Blue alliance</h4><div>{renderAllianceTeams(match.blueTeams)}</div></section>
		</div>
		<div className="dashboard-match-forecast"><strong>{winProbability === null ? "—" : `${Math.round(winProbability * 100)}%`}</strong><span>Win chance</span>
			{projectedOwnScore !== null && projectedOpponentScore !== null && <small>Projected score: {projectedOwnScore} - {projectedOpponentScore}</small>}
		</div>
	</article>;
}

function LatestMatchResults({ results, teamNumber, league, isLoading, error }: {
	results: LatestMatchResult[];
	teamNumber: string;
	league: League;
	isLoading: boolean;
	error: string;
}) {
	if (isLoading) return <p className="dashboard-empty" aria-busy="true">Loading {league} {teamNumber}'s latest results...</p>;
	if (error) return <p className="dashboard-empty" role="alert">{error}</p>;
	if (!results.length) return <p className="dashboard-empty">No completed matches found for {league} {teamNumber} at current or previous events.</p>;
	return <div className="dashboard-result-list">
		{results.map(({ event, match }) => {
			const isRedAlliance = match.redTeams.includes(teamNumber);
			const ownScore = isRedAlliance ? match.redScore! : match.blueScore!;
			const opponentScore = isRedAlliance ? match.blueScore! : match.redScore!;
			const outcome = ownScore === opponentScore ? "Tie" : ownScore > opponentScore ? "Win" : "Loss";
			const blueScoreClass = match.blueScore! === match.redScore! ? "" : match.blueScore! > match.redScore! ? "dashboard-result-score-winning" : "dashboard-result-score-losing";
			const redScoreClass = match.redScore! === match.blueScore! ? "" : match.redScore! > match.blueScore! ? "dashboard-result-score-winning" : "dashboard-result-score-losing";
			return <article className={`dashboard-result-card dashboard-result-${outcome.toLowerCase()}`} key={`${event.code}-${match.matchKey}-${teamNumber}`}>
				<header className="dashboard-result-heading">
					<span className="dashboard-result-event">{league} {teamNumber} · {event.name}</span>
					<strong><a href={eventHref(event, league, teamNumber, match.matchKey)}>Qualification {match.qualificationNumber}</a></strong>
					<em>{outcome}</em>
				</header>
				<div className="dashboard-result-alliances" aria-label={`Final score: blue ${match.blueScore}, red ${match.redScore}`}>
					<section className="dashboard-result-blue">
						<h4>Blue <strong className={blueScoreClass}>{match.blueScore}</strong></h4>
						<div>{match.blueTeams.length ? match.blueTeams.map((number) => <a className={number === teamNumber ? "dashboard-result-team-featured" : undefined} href={`/home?${new URLSearchParams({ team: number, league, season })}`} key={number}>{number}</a>) : <small>Teams unavailable</small>}</div>
					</section>
					<section className="dashboard-result-red">
						<h4><strong className={redScoreClass}>{match.redScore}</strong> Red</h4>
						<div>{match.redTeams.length ? match.redTeams.map((number) => <a className={number === teamNumber ? "dashboard-result-team-featured" : undefined} href={`/home?${new URLSearchParams({ team: number, league, season })}`} key={number}>{number}</a>) : <small>Teams unavailable</small>}</div>
					</section>
				</div>
			</article>;
		})}
	</div>;
}
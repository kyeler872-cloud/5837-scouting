import { useAuth } from "@clerk/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type League = "FTC" | "FRC";
type SearchType = "team" | "event";
type EventSummary = {
	code: string;
	name: string;
	startDate: string | null;
	region: string;
	city: string;
	state: string;
	country: string;
};
type TeamSummary = { number: string; name: string; city: string; state: string; country: string };
type PersonalSearchSettings = { personal?: { searchLeague?: League; searchType?: SearchType }; error?: string };

const currentSeason = "2026";
const eventSeasons: Record<League, string[]> = {
	FTC: Array.from({ length: 2026 - 2020 + 1 }, (_, index) => String(2026 - index)),
	FRC: Array.from({ length: 2026 - 1992 + 1 }, (_, index) => String(2026 - index)),
};
const minimumEventQueryLength = 2;

async function readResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

function isIowa(event: EventSummary) {
	return event.region.toUpperCase() === "USIA" ||
		event.region.toLowerCase().includes("iowa") ||
		event.state.toUpperCase() === "IA" ||
		event.state.toLowerCase() === "iowa";
}

function eventMatches(event: EventSummary, query: string) {
	const searchable = [event.name, event.code, event.region, event.city, event.state, event.country]
		.join(" ")
		.toLocaleLowerCase();
	return query.toLocaleLowerCase().trim().split(/\s+/).every((part) => searchable.includes(part));
}

function eventRelevance(event: EventSummary, query: string) {
	const normalizedQuery = query.toLocaleLowerCase().trim();
	const name = event.name.toLocaleLowerCase();
	const code = event.code.toLocaleLowerCase();
	if (name === normalizedQuery || code === normalizedQuery) return 4;
	if (name.startsWith(normalizedQuery) || code.startsWith(normalizedQuery)) return 3;
	if (name.includes(normalizedQuery) || code.includes(normalizedQuery)) return 2;
	return 1;
}

export function GlobalSearch() {
	const { getToken } = useAuth();
	const [league, setLeague] = useState<League>("FTC");
	const [searchType, setSearchType] = useState<SearchType>("team");
	const [eventSeason, setEventSeason] = useState(currentSeason);
	const [query, setQuery] = useState("");
	const [events, setEvents] = useState<EventSummary[]>([]);
	const [team, setTeam] = useState<TeamSummary | null>(null);
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false);
	const userChangedPreferences = useRef(false);
	const eventCache = useRef(new Map<string, EventSummary[]>());
	const searchId = useRef(0);
	const searchTriggerRef = useRef<HTMLButtonElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!mobileOverlayOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMobileOverlayOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		searchInputRef.current?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", closeOnEscape);
			searchTriggerRef.current?.focus();
		};
	}, [mobileOverlayOpen]);

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch("/api/settings?scope=personal", {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<PersonalSearchSettings>(response);
				if (!response.ok) throw new Error(data.error || "Could not load your search defaults.");
				if (active && !userChangedPreferences.current) {
					if (data.personal?.searchLeague === "FTC" || data.personal?.searchLeague === "FRC") setLeague(data.personal.searchLeague);
					if (data.personal?.searchType === "team" || data.personal?.searchType === "event") setSearchType(data.personal.searchType);
				}
			} catch (loadError) {
				if (active) setError(loadError instanceof Error ? loadError.message : "Could not load your search defaults.");
			}
		})();
		return () => { active = false; };
	}, [getToken]);

	useEffect(() => {
		const currentSearch = ++searchId.current;
		setEvents([]);
		setTeam(null);
		setIsLoading(false);
		if (
			(searchType === "event" && query.trim().length < minimumEventQueryLength) ||
			(searchType === "team" && !/^\d{1,6}$/.test(query.trim()))
		) {
			setError("");
			return;
		}

		setIsLoading(true);
		const controller = new AbortController();
		const timeout = window.setTimeout(() => {
			void (async () => {
				setError("");
				try {
					const token = await getToken();
					const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
					if (searchType === "event") {
						const cacheKey = `${league}:${eventSeason}`;
						let items = eventCache.current.get(cacheKey);
						if (!items) {
							const params = new URLSearchParams({ league, season: eventSeason });
							const response = await fetch(`/api/events?${params}`, { headers, signal: controller.signal });
							const data = await readResponse<{ events?: EventSummary[]; error?: string }>(response);
							if (!response.ok) throw new Error(data.error || "Event search failed.");
							items = data.events || [];
							eventCache.current.set(cacheKey, items);
						}
						const matches = items
							.filter((event) => eventMatches(event, query))
							.sort((first, second) =>
								eventRelevance(second, query) - eventRelevance(first, query) ||
								Number(isIowa(second)) - Number(isIowa(first)) ||
								(first.startDate || "9999").localeCompare(second.startDate || "9999") ||
								first.name.localeCompare(second.name)
							)
							.slice(0, 6);
						if (currentSearch === searchId.current) setEvents(matches);
					} else {
						const params = new URLSearchParams({ league, season: currentSeason });
						const response = await fetch(`/api/search/teams/${encodeURIComponent(query.trim())}?${params}`, {
							headers,
							signal: controller.signal,
						});
						const data = await readResponse<{ team?: TeamSummary | null; error?: string }>(response);
						if (!response.ok) throw new Error(data.error || "Team search failed.");
						if (currentSearch === searchId.current) setTeam(data.team || null);
					}
				} catch (searchError) {
					if (!controller.signal.aborted && currentSearch === searchId.current) {
						setError(searchError instanceof Error ? searchError.message : "Search failed.");
					}
				} finally {
					if (!controller.signal.aborted && currentSearch === searchId.current) setIsLoading(false);
				}
			})();
		}, 300);
		return () => {
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [eventSeason, getToken, league, query, searchType]);

	const eventHref = (event: EventSummary) =>
		`/events/${league}/${eventSeason}/${encodeURIComponent(event.code)}?${new URLSearchParams({ league, season: eventSeason })}`;
	const teamHref = team ? `/home?${new URLSearchParams({ team: team.number, league, season: currentSeason })}` : "";
	const hasResults = searchType === "event" ? events.length > 0 : Boolean(team);
	const hasSearchableQuery = searchType === "event"
		? query.trim().length >= minimumEventQueryLength
		: /^\d{1,6}$/.test(query.trim());
	const invalidTeamQuery = searchType === "team" && query.trim().length > 0 && !/^\d{1,6}$/.test(query.trim());

	function submitSearch(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (searchType === "event" && events[0]) window.location.assign(eventHref(events[0]));
		else if (searchType === "team" && /^\d{1,6}$/.test(query.trim())) {
			window.location.assign(`/home?${new URLSearchParams({ team: query.trim(), league, season: currentSeason })}`);
		}
	}

	function renderSearch(autoFocus = false) {
		return <>
			<form className="global-search-form" onSubmit={submitSearch}>
			<label className="global-search-select">
				<span className="visually-hidden">Program</span>
				<select value={league} onChange={(event) => {
					userChangedPreferences.current = true;
					const selectedLeague = event.target.value as League;
					setLeague(selectedLeague);
					if (!eventSeasons[selectedLeague].includes(eventSeason)) setEventSeason(currentSeason);
				}} aria-label="Program">
					<option value="FTC">FTC</option>
					<option value="FRC">FRC</option>
				</select>
			</label>
			<label className="global-search-select">
				<span className="visually-hidden">Search type</span>
				<select value={searchType} onChange={(event) => {
					userChangedPreferences.current = true;
					setSearchType(event.target.value as SearchType);
					setQuery("");
				}} aria-label="Search type">
					<option value="team">Teams</option>
					<option value="event">Events</option>
				</select>
			</label>
			<div className="global-search-input-wrap">
				<svg className="global-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></svg>
				<input
					type="search"
					ref={autoFocus ? searchInputRef : undefined}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={searchType === "team" ? "Search by team number" : "Search events, code, or location"}
					inputMode={searchType === "team" ? "numeric" : "search"}
					maxLength={searchType === "team" ? 6 : 100}
					aria-label={searchType === "team" ? "Search by team number" : "Search events by name, code, or location"}
					aria-controls="global-search-results"
					aria-expanded={hasSearchableQuery}
					autoComplete="off"
					autoFocus={autoFocus}
				/>
				{query && <button className="global-search-clear" type="button" aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
				<button className="global-search-submit" type="submit" aria-label="Open first search result">Search</button>
			</div>
			</form>
			{invalidTeamQuery && <p className="global-search-settings-error">Team search uses a 1–6 digit team number.</p>}
			{error && !hasSearchableQuery && <p className="global-search-settings-error" role="alert">{error}</p>}
			{hasSearchableQuery && <div className="global-search-results" id="global-search-results" aria-live="polite">
				{searchType === "event" && <p className="global-search-season">{league} {eventSeason}–{String(Number(eventSeason) + 1).slice(-2)} events</p>}
				{isLoading ? <p className="global-search-status">Searching {league} {searchType}…</p> : error ? <p className="global-search-status" role="alert">{error}</p> : hasResults
					? searchType === "event"
						? events.map((event) => <a className="global-search-result" href={eventHref(event)} key={event.code}>
							<strong>{event.name}</strong>
							<span>{[event.region === "USIA" ? "Iowa" : event.region, event.city, event.state, event.country].filter(Boolean).join(" · ") || event.code}</span>
							{isIowa(event) && <small>Iowa</small>}
						</a>)
						: team && <a className="global-search-result" href={teamHref}>
							<strong>{league} {team.number}{team.name ? ` · ${team.name}` : ""}</strong>
							<span>{[team.city, team.state, team.country].filter(Boolean).join(", ") || "Location unavailable"}</span>
						</a>
					: <p className="global-search-status">{searchType === "team" && !/^\d{1,6}$/.test(query.trim())
						? "Enter a team number to search."
						: `No matching ${searchType} found.`}</p>}
				{searchType === "event" && <label className="global-search-history">
					<span>Search past seasons</span>
					<select value={eventSeason} onChange={(event) => setEventSeason(event.target.value)} aria-label="Search events from season">
						{eventSeasons[league].map((year) => <option value={year} key={year}>{year}–{String(Number(year) + 1).slice(-2)} season</option>)}
					</select>
				</label>}
			</div>}
		</>;
	}

	return <>
		<div className="global-search" role="search" aria-label="Team and event search">
			<button
				className="mobile-global-search-trigger"
				type="button"
				ref={searchTriggerRef}
				aria-label="Open search"
				aria-haspopup="dialog"
				aria-expanded={mobileOverlayOpen}
				onClick={() => setMobileOverlayOpen(true)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></svg>
			</button>
			{!mobileOverlayOpen && <div className="global-search-inline">{renderSearch()}</div>}
		</div>
		{mobileOverlayOpen && typeof document !== "undefined" && createPortal(
			<div className="mobile-search-overlay">
				<button className="mobile-search-backdrop" type="button" aria-label="Close search" onClick={() => setMobileOverlayOpen(false)} />
				<section className="mobile-search-panel" role="dialog" aria-modal="true" aria-label="Search">
					<header className="mobile-search-heading">
						<strong>Search Scout 5837</strong>
						<button type="button" aria-label="Close search" onClick={() => setMobileOverlayOpen(false)}>×</button>
					</header>
					{renderSearch(true)}
				</section>
			</div>,
			document.body,
		)}
	</>;
}

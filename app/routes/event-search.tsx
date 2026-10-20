import { UserButton, useAuth } from "@clerk/react-router";
import { useEffect, useState } from "react";
import type { Route } from "./+types/event-search";
import { Protected } from "../protected";

type League = "FTC" | "FRC";
type EventSummary = {
	code: string;
	name: string;
	startDate: string | null;
	endDate: string | null;
	region: string;
	city: string;
	state: string;
	country: string;
	custom?: boolean;
};

const ftcSeasons = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
const frcSeasons = Array.from({ length: 2026 - 1992 + 1 }, (_, index) => 2026 - index);

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

export function meta({}: Route.MetaArgs) {
	return [{ title: "Search Events | Scout 5837" }, { name: "description", content: "Search FTC and FRC robotics events." }];
}

export default function EventSearchPage() {
	const { getToken } = useAuth();
	const [league, setLeague] = useState<League>("FTC");
	const [season, setSeason] = useState("2026");
	const [region, setRegion] = useState("Iowa");
	const [regions, setRegions] = useState<string[]>([]);
	const [events, setEvents] = useState<EventSummary[]>([]);
	const [error, setError] = useState("");
	const [warning, setWarning] = useState("");
	const [loading, setLoading] = useState(false);
	const [searched, setSearched] = useState(false);

	useEffect(() => {
		setSeason((current) => (league === "FTC" ? ftcSeasons : frcSeasons).includes(Number(current) ? current : "2026"));
		setRegion("Iowa");
		setEvents([]);
		setRegions([]);
		setSearched(false);
		setWarning("");
	}, [league]);

	useEffect(() => {
		let cancelled = false;
		async function loadRegions() {
			try {
				const token = await getToken();
				const params = new URLSearchParams({ league, season });
				const response = await fetch(`/api/events?${params}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await readResponse<{ regions?: string[]; error?: string }>(response);
				if (!response.ok) throw new Error(data.error || "Could not load event regions.");
				if (!cancelled) {
					const availableRegions = data.regions || [];
					setRegions(availableRegions);
					setRegion((current) => availableRegions.includes(current)
						? current
						: availableRegions.find((item) => item.toLowerCase().includes("iowa") || item.toUpperCase() === "IA") || "Iowa");
				}
			} catch (regionError) {
				if (!cancelled) setError(regionError instanceof Error ? regionError.message : "Could not load event regions.");
			}
		}
		void loadRegions();
		return () => { cancelled = true; };
	}, [getToken, league, season]);

	async function searchEvents(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError("");
		setWarning("");
		try {
			const token = await getToken();
			const params = new URLSearchParams({ league, season });
			if (region) params.set("region", region);
			const response = await fetch(`/api/events?${params}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			});
			const data = await readResponse<{ events?: EventSummary[]; regions?: string[]; warning?: string | null; error?: string }>(response);
			if (!response.ok) throw new Error(data.error || "Event search failed.");
			setEvents(data.events || []);
			setRegions(data.regions || []);
			setWarning(data.warning || "");
			setSearched(true);
		} catch (searchError) {
			setEvents([]);
			setError(searchError instanceof Error ? searchError.message : "Event search failed.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<Protected>
			<main className="home-shell">
				<nav className="topbar" aria-label="Main navigation">
					<a className="brand" href="/home"><span>Scout 5837</span></a>
					<div className="topbar-tabs" aria-label="Search mode">
						<a href="/home">Team search</a>
						<a href="/events" aria-current="page">Event search</a>
						<a href="/logs">Logs</a>
					</div>
					<UserButton />
				</nav>
				<section className="scouting-search" aria-labelledby="event-search-title">
					<p className="section-kicker">FIRST Robotics Scouting</p>
					<h1 id="event-search-title">search for an event!</h1>
					<p className="search-intro">Find an FTC or FRC event by program, season, and region.</p>
					<form className="team-search" onSubmit={(event) => void searchEvents(event)}>
						<div className="search-options event-search-options">
							<div><label htmlFor="event-league">Program</label><select id="event-league" value={league} onChange={(event) => setLeague(event.target.value as League)}><option value="FTC">FTC</option><option value="FRC">FRC</option></select></div>
							<div><label htmlFor="event-season">Season</label><select id="event-season" value={season} onChange={(event) => setSeason(event.target.value)}>{(league === "FTC" ? ftcSeasons : frcSeasons).map((year) => <option key={year} value={year}>{year}-{String(year + 1).slice(-2)}</option>)}</select></div>
							<div><label htmlFor="event-region">Region</label><select id="event-region" value={region} onChange={(event) => setRegion(event.target.value)}><option value="">All regions</option>{region && !regions.includes(region) && <option value={region}>{region}</option>}{regions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
						</div>
						<div className="search-row"><button className="search-button" type="submit" disabled={loading}>{loading ? "Searching..." : "Search events"}</button></div>
					</form>
					{error && <p className="lookup-error" role="alert">{error}</p>}
					{warning && <p className="lookup-warning" role="status">{warning}</p>}
				</section>
				{searched && (
					<section className="event-search-results" aria-live="polite">
						<header><p className="section-kicker">{league} / {season} season</p><h2>{events.length} {events.length === 1 ? "event" : "events"}</h2></header>
						{events.length ? <div className="event-card-grid">{events.map((event) => {
							const query = new URLSearchParams({ league, season });
							return <a className="event-search-card" href={`/events/${league}/${season}/${encodeURIComponent(event.code)}?${query}`} key={event.code}>
								<p className="event-card-meta">{event.region || "Region unavailable"}{event.custom && <span>Custom</span>}</p>
								<h3>{event.name}</h3>
								<p>{displayDate(event.startDate, event.endDate)}</p>
								{(event.city || event.state || event.country) && <p>{[event.city, event.state, event.country].filter(Boolean).join(", ")}</p>}
								<span className="event-card-open">Open event →</span>
							</a>;
						})}</div> : <p className="empty-event-results">No events were found for those filters.</p>}
					</section>
				)}
			</main>
		</Protected>
	);
}

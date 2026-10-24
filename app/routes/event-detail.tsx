import { UserButton, useAuth } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router";
import type { Route } from "./+types/event-detail";
import { Protected } from "../protected";

type League = "FTC" | "FRC";
type EventTeam = { number: string; name: string; manual: boolean };
type EventData = {
	league: League;
	season: string;
	eventCode: string;
	event: { name: string; startDate: string | null; endDate: string | null; city: string; state: string; country: string; region: string; custom: boolean };
	teams: EventTeam[];
	notes: Record<string, { value: string; displayName: string }>;
	photosUrl: string;
	warning: string | null;
};
type NoteCategory = "Matches" | "Playoffs" | "Notes";
const categories: NoteCategory[] = ["Matches", "Playoffs", "Notes"];

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
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const query = new URLSearchParams(location.search);
	const requestedReturn = query.get("returnTo") || "";
	const returnTo = requestedReturn.startsWith("/home") || requestedReturn.startsWith("/events") ? requestedReturn : "/events";

	useEffect(() => {
		let cancelled = false;
		async function load() {
			setLoading(true);
			setEventData(null);
			setError("");
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
		setEventData(data as EventData);
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

	return (
		<Protected>
			<main className="home-shell">
				<nav className="topbar" aria-label="Main navigation">
					<a className="brand" href="/home"><span>Scout 5837</span></a>
					<div className="topbar-tabs" aria-label="Search mode">
						<a href="/home">Team search</a><a href="/compare">Compare</a><a href="/events" aria-current="page">Event search</a><a href="/settings">Settings</a>
					</div>
					<UserButton />
				</nav>
				<div className="event-detail-page">
					<a className="event-back-link" href={returnTo}>← Back</a>
					{loading && <p className="event-page-status" aria-busy="true">Loading event...</p>}
					{error && <p className="lookup-error" role="alert">{error}</p>}
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
								<p className="section-kicker">Participating teams</p>
								<h2 id="event-roster-heading">Teams <span>{eventData.teams.length}</span></h2>
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
							</section>
							<section className="event-notes" aria-labelledby="event-notes-heading">
								<p className="section-kicker">Shared event notes</p>
								<h2 id="event-notes-heading">Scout notes</h2>
								<div className="event-note-tabs" role="tablist" aria-label="Note category">
									{categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
								</div>
								<label className="event-note-editor"><span>{category}</span><textarea rows={12} maxLength={10000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Add ${category.toLowerCase()} notes for this event...`} /></label>
								<div className="event-note-actions"><button className="search-button" type="button" disabled={saving} onClick={() => void save({ action: "note", category, note: draft }).catch(() => undefined)}>{saving ? "Saving..." : "Save notes"}</button><span>{eventData.notes[category]?.displayName ? `Last updated by ${eventData.notes[category].displayName}` : "No notes yet"}</span></div>
							</section>
						</div>
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

function PhotoIcon() {
	return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.4" /><path d="m5 17 5-4.5 3.2 2.6 2.3-2 3.5 3.1" /></svg>;
}

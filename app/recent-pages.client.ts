export type RecentPage = {
	href: string;
	title: string;
	detail?: string;
	visitedAt: string;
};

const RECENT_PAGES_KEY = "scouting-recent-pages";
const RECENT_PAGES_CHANGED = "scouting-recent-pages-changed";
const MAX_RECENT_PAGES = 8;

function readStoredPages(): RecentPage[] {
	try {
		const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_PAGES_KEY) || "[]");
		if (!Array.isArray(stored)) return [];
		return stored.filter((page): page is RecentPage =>
			typeof page === "object" &&
			page !== null &&
			"href" in page &&
			typeof page.href === "string" &&
			page.href.startsWith("/") &&
			!page.href.startsWith("//") &&
			"title" in page &&
			typeof page.title === "string" &&
			(!("detail" in page) || typeof page.detail === "string") &&
			"visitedAt" in page &&
			typeof page.visitedAt === "string",
		).slice(0, MAX_RECENT_PAGES);
	} catch (error) {
		console.error("Could not read recently visited pages.", error);
		return [];
	}
}

function pageTitle(url: URL) {
	const parts = url.pathname.split("/").filter(Boolean);
	if (url.pathname === "/home") {
		const team = url.searchParams.get("team");
		if (team) return `${url.searchParams.get("league")?.toUpperCase() || "FTC"} ${team}`;
		return url.searchParams.get("view") === "search" ? "Team search" : "Dashboard";
	}
	if (url.pathname === "/compare") {
		const team = url.searchParams.get("team");
		return team
			? `${url.searchParams.get("league")?.toUpperCase() || "FTC"} ${team} comparison`
			: "Team comparison";
	}
	if (url.pathname === "/events") return "Browse events";
	if (url.pathname === "/settings") return "Settings";
	if (url.pathname === "/terms-of-service") return "Terms of service";
	if (parts.length === 4 && parts[0] === "events") {
		let eventCode = parts[3];
		try {
			eventCode = decodeURIComponent(eventCode);
		} catch {
			// Keep the encoded path segment as a readable fallback.
		}
		return eventCode;
	}
	return null;
}

export function readRecentPages() {
	return readStoredPages();
}

export function subscribeToRecentPages(onChange: () => void) {
	window.addEventListener(RECENT_PAGES_CHANGED, onChange);
	window.addEventListener("storage", onChange);
	return () => {
		window.removeEventListener(RECENT_PAGES_CHANGED, onChange);
		window.removeEventListener("storage", onChange);
	};
}

export function trackRecentPage(path: string, titleOverride?: string, detailOverride?: string) {
	const url = new URL(path, window.location.origin);
	const title = titleOverride || pageTitle(url);
	if (!title) return;
	const href = `${url.pathname}${url.search}`;
	const parts = url.pathname.split("/").filter(Boolean);
	const detail = detailOverride || (parts.length === 4 && parts[0] === "events"
		? `${parts[1].toUpperCase()} ${parts[2]}${url.searchParams.has("match") ? ` · Qualification ${url.searchParams.get("match")?.replace(/^qual-/, "")}` : ""}`
		: url.pathname === "/home" && url.searchParams.has("team")
			? `${url.searchParams.get("season") || "2026"} season`
			: url.pathname === "/compare" && url.searchParams.has("team")
				? `${url.searchParams.get("league")?.toUpperCase() || "FTC"} · ${url.searchParams.get("season") || "2026"}`
				: undefined);
	const pages = [
		{ href, title, ...(detail ? { detail } : {}), visitedAt: new Date().toISOString() },
		...readStoredPages().filter((page) => page.href !== href),
	].slice(0, MAX_RECENT_PAGES);
	try {
		window.localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(pages));
		window.dispatchEvent(new Event(RECENT_PAGES_CHANGED));
	} catch (error) {
		console.error("Could not save recently visited pages.", error);
	}
}

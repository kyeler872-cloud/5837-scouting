import { useEffect, useState, type ReactNode } from "react";
import { UserButton } from "@clerk/react-router";

type NavigationPage = "dashboard" | "team-search" | "compare" | "events" | "settings";

const links: { page: NavigationPage; href: string; label: string }[] = [
	{ page: "dashboard", href: "/home", label: "Dashboard" },
	{ page: "team-search", href: "/home?view=search", label: "Team search" },
	{ page: "compare", href: "/compare", label: "Compare" },
	{ page: "events", href: "/events", label: "Events" },
	{ page: "settings", href: "/settings", label: "Settings" },
];

export function TopNavigation({ currentPage, rightContent }: { currentPage?: NavigationPage; rightContent?: ReactNode }) {
	const [showBackToTop, setShowBackToTop] = useState(false);

	useEffect(() => {
		const updateVisibility = () => {
			setShowBackToTop(window.matchMedia("(max-width: 560px)").matches && window.scrollY > 250);
		};
		updateVisibility();
		window.addEventListener("scroll", updateVisibility, { passive: true });
		window.addEventListener("resize", updateVisibility);
		return () => {
			window.removeEventListener("scroll", updateVisibility);
			window.removeEventListener("resize", updateVisibility);
		};
	}, []);

	return (
		<>
			<nav className="topbar" aria-label="Main navigation">
				<a className="brand" href="/home"><span>Scout 5837</span></a>
				<div className="topbar-tabs" aria-label="Main pages">
					{links.map((link) => <a key={link.page} href={link.href} aria-label={link.label} title={link.label} aria-current={currentPage === link.page ? "page" : undefined}>
						<NavigationIcon page={link.page} />
						<span className="topbar-tab-label">{link.label}</span>
					</a>)}
				</div>
				<div className="topbar-actions">{rightContent ?? <UserButton />}</div>
			</nav>
			{showBackToTop && <button className="mobile-back-to-top" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
				↑ <span>Back to top</span>
			</button>}
		</>
	);
}

function NavigationIcon({ page }: { page: NavigationPage }) {
	const paths: Record<NavigationPage, ReactNode> = {
		dashboard: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
		"team-search": <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></>,
		compare: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
		events: <><rect x="3.5" y="5" width="17" height="16" rx="1.5" /><path d="M7.5 3v4M16.5 3v4M3.5 10h17" /></>,
		settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.3 1-1.5 2.6-1.6-.6a7.8 7.8 0 0 1-1.6.9l-.3 1.7h-3l-.3-1.7a7.8 7.8 0 0 1-1.6-.9l-1.6.6-1.5-2.6 1.3-1a7.3 7.3 0 0 1 0-1.9l-1.3-1 1.5-2.6 1.6.6a7.8 7.8 0 0 1 1.6-.9l.3-1.7h3l.3 1.7a7.8 7.8 0 0 1 1.6.9l1.6-.6 1.5 2.6-1.3 1a7.3 7.3 0 0 1 0 1.8Z" /></>,
	};
	return <svg className="topbar-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[page]}</svg>;
}
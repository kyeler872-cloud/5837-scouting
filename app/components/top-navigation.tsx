import type { ReactNode } from "react";
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
	return (
		<nav className="topbar" aria-label="Main navigation">
			<a className="brand" href="/home"><span>Scout 5837</span></a>
			<div className="topbar-tabs" aria-label="Main pages">
				{links.map((link) => <a key={link.page} href={link.href} aria-current={currentPage === link.page ? "page" : undefined}>{link.label}</a>)}
			</div>
			<div className="topbar-actions">{rightContent ?? <UserButton />}</div>
		</nav>
	);
}
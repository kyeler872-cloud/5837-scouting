import { useEffect, useState, type ReactNode } from "react";
import { UserButton } from "@clerk/react-router";
import { GlobalSearch } from "./global-search";

type NavigationPage = "dashboard" | "compare" | "settings";

const links: { page: NavigationPage; href: string; label: string }[] = [
	{ page: "dashboard", href: "/home", label: "Dashboard" },
	{ page: "compare", href: "/compare", label: "Compare" },
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
				<GlobalSearch />
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
		compare: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></>,
		settings: <><path d="M9.8 2.5h4.4l.55 2.3a7.8 7.8 0 0 1 1.7 1l2.15-.9 2.2 3.8-1.65 1.7a7.8 7.8 0 0 1 0 2.1l1.65 1.7-2.2 3.8-2.15-.9a7.8 7.8 0 0 1-1.7 1L14.2 21.5H9.8l-.55-2.3a7.8 7.8 0 0 1-1.7-1l-2.15.9-2.2-3.8 1.65-1.7a7.8 7.8 0 0 1 0-2.1L3.2 9.8 5.4 6l2.15.9a7.8 7.8 0 0 1 1.7-1L9.8 2.5Z" /><circle cx="12" cy="12" r="3.1" /></>,
	};
	return <svg className="topbar-tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[page]}</svg>;
}
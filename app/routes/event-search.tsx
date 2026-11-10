import type { Route } from "./+types/event-search";
import { Protected } from "../protected";
import { TopNavigation } from "../components/top-navigation";

export function meta({}: Route.MetaArgs) {
	return [{ title: "Search Events | Scout 5837" }, { name: "description", content: "Search FTC and FRC robotics events as you type." }];
}

export default function EventSearchPage() {
	return (
		<Protected requireOrganization={false}>
			<main className="home-shell">
				<TopNavigation />
				<section className="live-search-help">
					<p className="section-kicker">FIRST Robotics Scouting</p>
					<h1>Find an event</h1>
					<p>Choose Events in the search bar to see live matches by event name, code, or location. Iowa events are ranked first when they match.</p>
				</section>
			</main>
		</Protected>
	);
}

import { useClerk } from "@clerk/react-router";
import { Link } from "react-router";
import type { Route } from "./+types/onboarding";

export function meta({}: Route.MetaArgs) {
	return [{ title: "Join Scout 5837" }];
}

export default function OnboardingPage() {
	const clerk = useClerk();

	return (
		<main className="organization-public-page">
			<p className="section-kicker">Scout 5837</p>
			<h1>Get started</h1>
			<p>Join an existing robotics organization with its code, or request access for your team.</p>
			<div className="organization-choice-grid">
				<Link className="organization-choice" to="/join">
					<strong>Join an organization</strong>
					<span>Use the join code shared by a mentor.</span>
				</Link>
				<Link className="organization-choice" to="/request-access">
					<strong>Request access</strong>
					<span>Apply to start a new team organization.</span>
				</Link>
			</div>
			<button className="search-button" type="button" onClick={() => void clerk.signOut({ redirectUrl: "/" })}>
				Sign out
			</button>
		</main>
	);
}

import type { Route } from "./+types/home";
import {
	Show,
	SignInButton,
	SignUpButton,
	UserButton,
} from "@clerk/react";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "This is 5837" },
		{ name: "description", content: "5837 is the best!" },
	];
}

export default function Home() {
	return (
		<main className="home-shell">
			<nav className="topbar" aria-label="Main navigation">
				<a className="brand" href="/">
					<span>Scout 5837</span>
				</a>
				<div className="auth-controls">
					<Show when="signed-out">
						<SignInButton mode="modal">
							<button className="button button-quiet" type="button">Sign in</button>
						</SignInButton>
						<SignUpButton mode="modal">
							<button className="button button-solid" type="button">Sign up</button>
						</SignUpButton>
					</Show>
					<Show when="signed-in">
						<UserButton />
					</Show>
				</div>
			</nav>
			<p className="progress-message">Wecome robotics member :) this part is in progress</p>
		</main>
	);
}

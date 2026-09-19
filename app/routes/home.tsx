import type { Route } from "./+types/home";
import {
	Show,
	UserButton,
} from "@clerk/react";
import { Protected } from "../protected";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "This is 5837" },
		{ name: "description", content: "5837 is the best!" },
	];
}

export default function Home() {
	return (
		<Protected>
			<main className="home-shell">
				<nav className="topbar" aria-label="Main navigation">
					<a className="brand" href="/home">
						<span>Scout 5837</span>
					</a>
					<Show when="signed-in">
						<UserButton />
					</Show>
				</nav>
				<p className="progress-message">Wecome robotics member :) this part is in progress</p>
			</main>
		</Protected>
	);
}

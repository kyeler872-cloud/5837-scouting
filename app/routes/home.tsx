import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "This is 5837" },
		{ name: "description", content: "5837 is the best!" },
	];
}

export default function Home() {
	return <h1>This is 5837</h1>;
}

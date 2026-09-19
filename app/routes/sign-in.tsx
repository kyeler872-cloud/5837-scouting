import { SignIn } from "@clerk/react";
import type { Route } from "./+types/sign-in";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Sign in | Scout 5837" },
		{ name: "description", content: "Sign in to Scout 5837." },
	];
}

export default function SignInPage() {
	return (
		<main className="sign-in-page">
			<div className="sign-in-brand">Scout 5837</div>
			<SignIn routing="hash" fallbackRedirectUrl="/home" />
		</main>
	);
}

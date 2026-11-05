import { SignIn } from "@clerk/react-router";
import type { Route } from "./+types/sign-in";
import { Link } from "react-router";

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
			<SignIn signUpUrl="/onboarding" />
			<Link to="/onboarding">Create an account</Link>
		</main>
	);
}

import { SignUp } from "@clerk/react-router";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/sign-up";
import { getSafeAuthRedirectUrl } from "../auth-redirect";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Create an account | Scout 5837" },
		{ name: "description", content: "Create a Scout 5837 account." },
	];
}

export default function SignUpPage() {
	const [searchParams] = useSearchParams();
	const redirectUrl = getSafeAuthRedirectUrl(searchParams.get("redirect_url"), "/");
	const signInUrl = `/?redirect_url=${encodeURIComponent(redirectUrl)}`;

	return (
		<main className="sign-in-page">
			<div className="sign-in-brand">Scout 5837</div>
			<SignUp forceRedirectUrl={redirectUrl} signInUrl={signInUrl} />
			<Link to={signInUrl}>Already have an account? Sign in</Link>
		</main>
	);
}

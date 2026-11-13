import { SignIn, useAuth, useClerk } from "@clerk/react-router";
import type { Route } from "./+types/sign-in";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { getSafeAuthRedirectUrl } from "../auth-redirect";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Sign in | Scout 5837" },
		{ name: "description", content: "Sign in to Scout 5837." },
	];
}

export default function SignInPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const clerk = useClerk();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const [checkError, setCheckError] = useState("");
	const [retryCount, setRetryCount] = useState(0);
	const redirectUrl = getSafeAuthRedirectUrl(searchParams.get("redirect_url"), "/");
	const signUpUrl = `/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`;

	useEffect(() => {
		if (!isLoaded || !isSignedIn) return;
		let active = true;
		setCheckError("");
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch("/api/organizations", {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const text = await response.text();
				let data: { organization?: { clerkOrganizationId: string | null }; error?: string };
				try {
					data = JSON.parse(text) as typeof data;
				} catch {
					throw new Error(text || `Request failed (${response.status}).`);
				}
				if (!response.ok) throw new Error(data.error || "Could not check organization access.");
				if (!active) return;
				if (!data.organization) {
					navigate("/onboarding", { replace: true });
					return;
				}
				if (data.organization.clerkOrganizationId && clerk.loaded) {
					await clerk.setActive({ organization: data.organization.clerkOrganizationId });
				}
				if (!active) return;
				const destination = redirectUrl === "/" || redirectUrl === "/onboarding" ? "/home" : redirectUrl;
				navigate(destination, { replace: true });
			} catch (error) {
				if (active) setCheckError(error instanceof Error ? error.message : "Could not check organization access.");
			}
		})();
		return () => { active = false; };
	}, [clerk, getToken, isLoaded, isSignedIn, navigate, redirectUrl, retryCount]);

	if (!isLoaded) {
		return <main className="organization-checking" aria-busy="true"><p>Checking your sign-in...</p></main>;
	}

	if (isSignedIn) {
		return <main className="organization-checking" aria-busy={!checkError}>
			<p className="sign-in-brand">Scout 5837</p>
			{checkError
				? <section><h1>Could not check your organization</h1><p role="alert">{checkError}</p><button className="search-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button></section>
				: <p role="status">Checking your organization...</p>}
		</main>;
	}

	return (
		<main className="sign-in-page">
			<div className="sign-in-brand">Scout 5837</div>
			<SignIn routing="path" path="/" forceRedirectUrl={redirectUrl} signUpUrl={signUpUrl} />
			<Link to={signUpUrl}>Create an account</Link>
		</main>
	);
}

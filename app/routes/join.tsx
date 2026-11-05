import { SignUp, useAuth, useClerk } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/join";

async function responseData<T>(response: Response) {
	const text = await response.text();
	try {
		return JSON.parse(text) as T & { error?: string };
	} catch {
		throw new Error(text || `Request failed (${response.status}).`);
	}
}

export function meta({}: Route.MetaArgs) {
	return [{ title: "Join an organization | Scout 5837" }];
}

export default function JoinOrganizationPage() {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const clerk = useClerk();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const [code, setCode] = useState(searchParams.get("code") || "");
	const [error, setError] = useState("");
	const [isJoining, setIsJoining] = useState(false);

	useEffect(() => {
		if (!isLoaded || !isSignedIn) return;
		let active = true;
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch("/api/organizations", {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await responseData<{ organization?: { id: string; clerkOrganizationId: string | null }; error?: string }>(response);
				if (!response.ok) throw new Error(data.error || "Could not check organization access.");
				if (active && data.organization) {
					if (data.organization.clerkOrganizationId && clerk.loaded) {
						await clerk.setActive({ organization: data.organization.clerkOrganizationId });
					}
					navigate("/home", { replace: true });
				}
			} catch (loadError) {
				if (active) setError(loadError instanceof Error ? loadError.message : "Could not check organization access.");
			}
		})();
		return () => { active = false; };
	}, [clerk, getToken, isLoaded, isSignedIn, navigate]);

	async function join(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setIsJoining(true);
		setError("");
		try {
			const token = await getToken();
			if (!token) throw new Error("Sign in to join an organization.");
			const response = await fetch("/api/organizations", {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ action: "join", code }),
			});
			const data = await responseData<{ organization?: { id: string; clerkOrganizationId: string | null } }>(response);
			if (!response.ok) throw new Error(data.error || "Could not join this organization.");
			if (data.organization?.clerkOrganizationId && clerk.loaded) {
				await clerk.setActive({ organization: data.organization.clerkOrganizationId });
			}
			navigate("/home", { replace: true });
		} catch (joinError) {
			setError(joinError instanceof Error ? joinError.message : "Could not join this organization.");
		} finally {
			setIsJoining(false);
		}
	}

	const signUpUrl = `/join${code.trim() ? `?code=${encodeURIComponent(code.trim())}` : ""}`;
	return (
		<main className="organization-public-page">
			<p className="section-kicker">Organization membership</p>
			<h1>Join an organization</h1>
			<p>Enter the code shared by an organization mentor. New members join as students.</p>
			{error && <p className="lookup-error" role="alert">{error}</p>}
			<form className="organization-form" onSubmit={(event) => void join(event)}>
				<label htmlFor="organization-code">Organization code</label>
				<input id="organization-code" autoComplete="off" maxLength={20} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required />
				{isSignedIn
					? <button className="search-button" type="submit" disabled={!isLoaded || isJoining}>{isJoining ? "Joining..." : "Join organization"}</button>
					: <Link to={`/?redirect_url=${encodeURIComponent(signUpUrl)}`}>Sign in to continue</Link>}
			</form>
			{isLoaded && !isSignedIn && <section className="join-signup">
				<p>Create your Scout 5837 account to continue with this code.</p>
				<SignUp forceRedirectUrl={signUpUrl} signInUrl="/" />
			</section>}
			<p><Link to="/request-access">Need a new organization? Request access</Link></p>
			<p><Link to="/onboarding">Back</Link></p>
		</main>
	);
}

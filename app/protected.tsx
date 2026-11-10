import { useAuth, useUser } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { saveContributorName as saveLocalContributorName } from "./contributor.client";
import { Link } from "react-router";

type OrganizationStatus = "checking" | "ready" | "missing" | "error";

export function Protected({ children, requireOrganization = true }: { children: React.ReactNode; requireOrganization?: boolean }) {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { isLoaded: isUserLoaded, user } = useUser();
	const [timedOut, setTimedOut] = useState(false);
	const [contributorStatus, setContributorStatus] = useState<"checking" | "ready" | "required" | "error">("checking");
	const [contributorIsKiosk, setContributorIsKiosk] = useState(false);
	const [contributorExpiresAt, setContributorExpiresAt] = useState<string | null>(null);
	const [nameDraft, setNameDraft] = useState("");
	const [contributorError, setContributorError] = useState("");
	const [isSavingName, setIsSavingName] = useState(false);
	const [retryCount, setRetryCount] = useState(0);
	const [organizationStatus, setOrganizationStatus] = useState<OrganizationStatus>("checking");
	const [organizationError, setOrganizationError] = useState("");
	const [organizationIsAdmin, setOrganizationIsAdmin] = useState(false);
	const [organizationRetryCount, setOrganizationRetryCount] = useState(0);
	const email = user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() || "";

	useEffect(() => {
		if (isLoaded) {
			return;
		}

		const timeout = window.setTimeout(() => setTimedOut(true), 5000);
		return () => window.clearTimeout(timeout);
	}, [isLoaded]);

	useEffect(() => {
		if (!isLoaded || !isUserLoaded) return;
		let active = true;
		setContributorError("");
		if (!isSignedIn) {
			setContributorStatus("ready");
			return () => { active = false; };
		}
		setContributorStatus("checking");
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch("/api/settings?scope=contributor", {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await response.json() as { contributor?: { required: boolean; kiosk: boolean; name: string | null; expiresAt: string | null }; error?: string };
				if (!response.ok || !data.contributor) throw new Error(data.error || "Could not check your credited name.");
				if (!active) return;
				const name = data.contributor.required ? data.contributor.name : null;
				setNameDraft(name || "");
				setContributorIsKiosk(data.contributor.kiosk);
				setContributorExpiresAt(data.contributor.expiresAt);
				setContributorStatus(data.contributor.required && !name ? "required" : "ready");
			} catch (error) {
				if (!active) return;
				setContributorError(error instanceof Error ? error.message : "Could not check your credited name.");
				setContributorStatus("error");
			}
		})();
		return () => { active = false; };
	}, [getToken, isLoaded, isSignedIn, isUserLoaded, retryCount]);

	useEffect(() => {
		if (contributorStatus !== "ready" || !contributorIsKiosk || !contributorExpiresAt) return;
		const remaining = new Date(contributorExpiresAt).getTime() - Date.now();
		if (remaining <= 0) {
			setNameDraft("");
			setContributorStatus("required");
			return;
		}
		const timeout = window.setTimeout(() => {
			setNameDraft("");
			setContributorStatus("required");
		}, remaining);
		return () => window.clearTimeout(timeout);
	}, [contributorExpiresAt, contributorIsKiosk, contributorStatus]);

	useEffect(() => {
		const updateExpiration = (event: Event) => {
			const expiresAt = (event as CustomEvent<{ expiresAt?: unknown }>).detail?.expiresAt;
			if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
				setContributorExpiresAt(new Date(expiresAt).toISOString());
			}
		};
		window.addEventListener("scouting-contributor-updated", updateExpiration);
		return () => window.removeEventListener("scouting-contributor-updated", updateExpiration);
	}, []);

	useEffect(() => {
		if (!isLoaded || !isSignedIn) return;
		let active = true;
		setOrganizationStatus("checking");
		setOrganizationError("");
		void (async () => {
			try {
				const token = await getToken();
				const response = await fetch("/api/organizations", {
					headers: token ? { Authorization: `Bearer ${token}` } : undefined,
				});
				const data = await response.json() as { organization?: unknown; isAdmin?: boolean; error?: string };
				if (!response.ok) throw new Error(data.error || "Could not check organization access.");
				if (!active) return;
				setOrganizationIsAdmin(Boolean(data.isAdmin));
				setOrganizationStatus(data.organization ? "ready" : "missing");
			} catch (error) {
				if (!active) return;
				setOrganizationError(error instanceof Error ? error.message : "Could not check organization access.");
				setOrganizationStatus("error");
			}
		})();
		return () => { active = false; };
	}, [getToken, isLoaded, isSignedIn, organizationRetryCount]);

	if (!isLoaded && !timedOut) {
		return <main className="auth-loading" aria-busy="true" />;
	}

	if (!isSignedIn) {
		return <Navigate to="/" replace />;
	}

	if (organizationStatus === "checking") return <main className="auth-loading" aria-busy="true" />;

	if (requireOrganization && organizationStatus === "missing") {
		return organizationIsAdmin
			? <>{children}</>
			: <Navigate to="/onboarding" replace />;
	}

	if (requireOrganization && organizationStatus === "error") {
		return <main className="contributor-name-page"><section>
			<p className="section-kicker">Organization access</p>
			<h1>Could not verify access</h1>
			<p role="alert">{organizationError}</p>
			<button className="search-button" type="button" onClick={() => setOrganizationRetryCount((count) => count + 1)}>Try again</button>
			{email === "kyelerw@icloud.com" && <p><Link to="/admin">Open the organization admin panel</Link></p>}
		</section></main>;
	}

	if (contributorStatus === "checking" || !isUserLoaded) {
		return <main className="auth-loading" aria-busy="true" />;
	}

	if (contributorStatus === "error") {
		return <main className="contributor-name-page"><section>
			<p className="section-kicker">{contributorIsKiosk ? "Team device" : "Contribution credit"}</p>
			<h1>What is your name?</h1>
			<p role="alert">{contributorError}</p>
			<button className="search-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
		</section></main>;
	}

	if (contributorStatus === "required") {
		async function saveContributorName(event: React.FormEvent<HTMLFormElement>) {
			event.preventDefault();
			setIsSavingName(true);
			setContributorError("");
			try {
				const token = await getToken();
				const response = await fetch("/api/settings", {
					method: "PUT",
					headers: { "content-type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
					body: JSON.stringify({ action: "contributor-name", contributorName: nameDraft }),
				});
				const data = await response.json() as { contributor?: { name: string; expiresAt: string | null }; error?: string };
				if (!response.ok || !data.contributor) throw new Error(data.error || "Could not save your credited name.");
				saveLocalContributorName(data.contributor.name, contributorIsKiosk ? 3600 : 31_536_000, data.contributor.expiresAt ? Date.parse(data.contributor.expiresAt) : undefined);
				setContributorExpiresAt(data.contributor.expiresAt);
				setContributorStatus("ready");
			} catch (error) {
				setContributorError(error instanceof Error ? error.message : "Could not save your credited name.");
			} finally {
				setIsSavingName(false);
			}
		}

		return <main className="contributor-name-page"><section>
			<p className="section-kicker">{contributorIsKiosk ? "Team device" : "Contribution credit"}</p>
			<h1>What is your name?</h1>
			<p>{contributorIsKiosk
				? "Enter the name of the person using this team device. Contributions will use this name for one hour, then you’ll be asked again."
				: "This name is saved only on this device and will be credited for its contributions."}</p>
			<form onSubmit={(event) => void saveContributorName(event)}>
				<label htmlFor="contributor-name">Name</label>
				<input id="contributor-name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={80} autoComplete="name" required />
				{contributorError && <p className="lookup-error" role="alert">{contributorError}</p>}
				<button className="search-button" type="submit" disabled={isSavingName || !nameDraft.trim()}>{isSavingName ? "Saving..." : "Continue"}</button>
			</form>
		</section></main>;
	}

	return <>{children}</>;
}

import { useAuth, useUser } from "@clerk/react-router";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";

const CONTRIBUTOR_EMAIL = "frcteam5837@gmail.com";

export function Protected({ children }: { children: React.ReactNode }) {
	const { getToken, isLoaded, isSignedIn } = useAuth();
	const { isLoaded: isUserLoaded, user } = useUser();
	const [timedOut, setTimedOut] = useState(false);
	const [contributorStatus, setContributorStatus] = useState<"checking" | "ready" | "required" | "error">("checking");
	const [contributorName, setContributorName] = useState("");
	const [nameDraft, setNameDraft] = useState("");
	const [contributorError, setContributorError] = useState("");
	const [isSavingName, setIsSavingName] = useState(false);
	const [retryCount, setRetryCount] = useState(0);
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
		if (!isSignedIn || email !== CONTRIBUTOR_EMAIL) {
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
				const data = await response.json() as { contributor?: { required: boolean; name: string | null }; error?: string };
				if (!response.ok || !data.contributor) throw new Error(data.error || "Could not check your credited name.");
				if (!active) return;
				setContributorName(data.contributor.name || "");
				setNameDraft(data.contributor.name || "");
				setContributorStatus(data.contributor.required && !data.contributor.name ? "required" : "ready");
			} catch (error) {
				if (!active) return;
				setContributorError(error instanceof Error ? error.message : "Could not check your credited name.");
				setContributorStatus("error");
			}
		})();
		return () => { active = false; };
	}, [email, getToken, isLoaded, isSignedIn, isUserLoaded, retryCount]);

	if (!isLoaded && !timedOut) {
		return <main className="auth-loading" aria-busy="true" />;
	}

	if (!isSignedIn) {
		return <Navigate to="/" replace />;
	}

	if (contributorStatus === "checking" || (email === CONTRIBUTOR_EMAIL && !isUserLoaded)) {
		return <main className="auth-loading" aria-busy="true" />;
	}

	if (contributorStatus === "error") {
		return <main className="contributor-name-page"><section>
			<p className="section-kicker">Contribution credit</p>
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
					headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
					body: JSON.stringify({ action: "contributor-name", contributorName: nameDraft }),
				});
				const data = await response.json() as { contributor?: { name: string | null }; error?: string };
				if (!response.ok || !data.contributor?.name) throw new Error(data.error || "Could not save your credited name.");
				setContributorName(data.contributor.name);
				setContributorStatus("ready");
			} catch (error) {
				setContributorError(error instanceof Error ? error.message : "Could not save your credited name.");
			} finally {
				setIsSavingName(false);
			}
		}

		return <main className="contributor-name-page"><section>
			<p className="section-kicker">Contribution credit</p>
			<h1>What is your name?</h1>
			<p>This name will be credited for your contributions. It expires after one hour.</p>
			<form onSubmit={(event) => void saveContributorName(event)}>
				<label htmlFor="contributor-name">Name</label>
				<input id="contributor-name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={12} autoComplete="off" required />
				{contributorError && <p className="lookup-error" role="alert">{contributorError}</p>}
				<button className="search-button" type="submit" disabled={isSavingName || !nameDraft.trim()}>{isSavingName ? "Saving..." : "Continue"}</button>
			</form>
		</section></main>;
	}

	return <>{children}</>;
}

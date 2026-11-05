import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/request-access";

export function meta({}: Route.MetaArgs) {
	return [{ title: "Request organization access | Scout 5837" }];
}

export default function RequestAccessPage() {
	const [name, setName] = useState("");
	const [organizationName, setOrganizationName] = useState("");
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"student" | "mentor">("mentor");
	const [message, setMessage] = useState("");
	const [ftcTeamNumbers, setFtcTeamNumbers] = useState("");
	const [frcTeamNumbers, setFrcTeamNumbers] = useState("");
	const [website, setWebsite] = useState("");
	const [error, setError] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setIsSubmitting(true);
		try {
			const response = await fetch("/api/access-requests", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name, organizationName, email, role, message, ftcTeamNumbers, frcTeamNumbers, website }),
			});
			const text = await response.text();
			let data: { error?: string } = {};
			try { data = JSON.parse(text) as { error?: string }; } catch { throw new Error(text || "Could not submit your request."); }
			if (!response.ok) throw new Error(data.error || "Could not submit your request.");
			setSubmitted(true);
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : "Could not submit your request.");
		} finally {
			setIsSubmitting(false);
		}
	}

	if (submitted) return (
		<main className="organization-public-page">
			<p className="section-kicker">Request received</p>
			<h1>Thanks, {name}.</h1>
			<p>Your organization request is waiting for administrator review. You can sign in after your application is approved.</p>
			<Link to="/">Back to sign in</Link>
		</main>
	);

	return (
		<main className="organization-public-page">
			<p className="section-kicker">Organization application</p>
			<h1>Request access</h1>
			<p>Tell us about your team. The app administrator will review your request.</p>
			{error && <p className="lookup-error" role="alert">{error}</p>}
			<form className="organization-form" onSubmit={(event) => void submit(event)}>
				<label>Name<input autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required /></label>
				<label>Team or organization name<input maxLength={100} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
				<label>Email<input type="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
				<label>Role
					<select value={role} onChange={(event) => setRole(event.target.value as "student" | "mentor")}>
						<option value="mentor">Mentor</option>
						<option value="student">Student</option>
					</select>
				</label>
				<label>FTC team numbers <small>Separate multiple numbers with commas.</small>
					<input inputMode="numeric" maxLength={200} placeholder="7247, 5445" value={ftcTeamNumbers} onChange={(event) => setFtcTeamNumbers(event.target.value)} />
				</label>
				<label>FRC team numbers <small>Separate multiple numbers with commas.</small>
					<input inputMode="numeric" maxLength={200} placeholder="5837" value={frcTeamNumbers} onChange={(event) => setFrcTeamNumbers(event.target.value)} />
				</label>
				<label>Message<textarea rows={5} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
				<label className="organization-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
				<button className="search-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Submit request"}</button>
			</form>
			<p><Link to="/onboarding">Back</Link></p>
		</main>
	);
}

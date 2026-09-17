import type { Route } from "./+types/terms-of-service";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Terms of Service | Scout 5837" },
		{ name: "description", content: "Terms of Service for Scout 5837." },
	];
}

export default function TermsOfService() {
	return (
		<main className="home-shell">
			<nav className="topbar" aria-label="Main navigation">
				<a className="brand" href="/">
					<span>Scout 5837</span>
				</a>
				<a className="terms-link" href="/">Back to home</a>
			</nav>
			<article className="terms-page">
				<h1>Terms of Service</h1>
				<div className="terms-content">
					<p><b>1. Account Usage</b></p>
                       <p> By using this service, you understand that your account, managed through Clerk, may be erased at any time without a given notice. <br></br>
                        By using this service, you are implying that you are currently a member of any team under the Waterloo Robotics umbrella, and anybody that isn't an active member may be terminated from the service.<br></br>
                        Any account can be erased at any time, without compensation of anything at all.<br></br>
                        None of this should happen though, because why would anybody else find this silly website.</p>
                    <p><b>2. Data Usage</b></p>
                    <p>All of your data, if any, will be held by Kyeler W, and possibly under the Waterloo Robotics umbrella.<br></br>
                    You are not entitled to have your data erased.<br></br>
                    All data maintained through Clerk is subject to Clerk's privacy policy, and not affiliated with this service.<br></br>
                    If you are not gracious and professional, you aren't allowed to use this service 
                    </p>
				</div>
			</article>
		</main>
	);
}

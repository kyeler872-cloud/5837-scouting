import { HandleSSOCallback } from "@clerk/react-router";
import { useNavigate } from "react-router";
import type { Route } from "./+types/sso-callback";

export function meta({}: Route.MetaArgs) {
	return [{ title: "Signing in | Scout 5837" }];
}

export default function SsoCallbackPage() {
	const navigate = useNavigate();

	return (
		<main className="auth-loading" aria-busy="true">
			<HandleSSOCallback
				navigateToApp={({ decorateUrl }) => {
					const destination = decorateUrl("/");
					if (destination.startsWith("http")) {
						window.location.href = destination;
						return;
					}
					void navigate(destination);
				}}
				navigateToSignIn={() => navigate("/")}
				navigateToSignUp={() => navigate("/")}
			/>
			<p>Completing sign-in...</p>
		</main>
	);
}

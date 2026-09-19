import { useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";

export function Protected({ children }: { children: React.ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	const [timedOut, setTimedOut] = useState(false);

	useEffect(() => {
		if (isLoaded) {
			return;
		}

		const timeout = window.setTimeout(() => setTimedOut(true), 5000);
		return () => window.clearTimeout(timeout);
	}, [isLoaded]);

	if (!isLoaded && !timedOut) {
		return <main className="auth-loading" aria-busy="true" />;
	}

	if (!isSignedIn) {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

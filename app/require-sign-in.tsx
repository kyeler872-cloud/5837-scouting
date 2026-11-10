import { useAuth } from "@clerk/react-router";
import { Navigate, useLocation } from "react-router";

export function RequireSignIn({ children }: { children: React.ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	const location = useLocation();

	if (!isLoaded) return <main className="auth-loading" aria-busy="true" />;
	if (!isSignedIn) {
		const redirectUrl = `${location.pathname}${location.search}`;
		return <Navigate to={`/?redirect_url=${encodeURIComponent(redirectUrl)}`} replace />;
	}

	return <>{children}</>;
}

import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";
import { ClerkProvider, useAuth } from "@clerk/react-router";
import { useEffect } from "react";
import { clerkMiddleware } from "@clerk/react-router/server";
import { rootAuthLoader } from "@clerk/react-router/ssr.server";

import type { Route } from "./+types/root";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
	},
];

export async function loader(args: Route.LoaderArgs) {
	return rootAuthLoader(args);
}

function AccountTheme() {
	const { getToken, isLoaded, userId } = useAuth();

	useEffect(() => {
		let active = true;
		delete document.documentElement.dataset.theme;
		if (isLoaded && userId) {
			void (async () => {
				try {
					const token = await getToken();
					const response = await fetch("/api/settings?scope=personal", {
						headers: token ? { Authorization: `Bearer ${token}` } : undefined,
					});
					if (!response.ok) return;
					const data = await response.json() as { personal?: { theme?: string } };
					if (active) document.documentElement.dataset.theme = data.personal?.theme === "light" ? "light" : "dark";
				} catch {
					if (active) document.documentElement.dataset.theme = "dark";
				}
			})();
		}
		return () => { active = false; };
	}, [getToken, isLoaded, userId]);

	return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<ClerkProvider
			loaderData={loaderData}
			signInFallbackRedirectUrl="/home"
			signUpFallbackRedirectUrl="/home"
		>
			<AccountTheme />
			<Outlet />
		</ClerkProvider>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? "The requested page could not be found."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="pt-16 p-4 container mx-auto">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full p-4 overflow-x-auto">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}

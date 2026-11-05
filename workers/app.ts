import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/cloudflare-context";

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	fetch(request, env, ctx) {
		const url = new URL(request.url);
		const isAdminHost = url.hostname === "admin.5837scout.app";
		const normalizedPath = url.pathname.replace(/\/{2,}/g, "/");
		if (normalizedPath !== url.pathname) {
			url.pathname = normalizedPath;
			return Response.redirect(url, 308);
		}
		if (!isAdminHost && (normalizedPath === "/admin" || normalizedPath.startsWith("/admin/"))) {
			url.hostname = "admin.5837scout.app";
			return Response.redirect(url, 308);
		}
		if (isAdminHost && normalizedPath === "/") {
			url.pathname = "/admin";
			return Response.redirect(url, 308);
		}
		if (isAdminHost && normalizedPath !== "/admin" && normalizedPath !== "/api/admin") {
			url.hostname = "5837scout.app";
			return Response.redirect(url, 308);
		}

		const loadContext = new RouterContextProvider();
		loadContext.cloudflare = { env, ctx };
		loadContext.set(cloudflareContext, { env, ctx });
		return requestHandler(request, loadContext);
	},
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(env.SCOUTING_DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-7 days')").run()
			.catch((error) => {
				console.error(JSON.stringify({ message: "Could not expire old audit logs", error: error instanceof Error ? error.message : String(error) }));
			}));
	},
} satisfies ExportedHandler<Env>;

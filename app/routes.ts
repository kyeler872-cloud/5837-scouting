import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/sign-in.tsx"),
	route("api/teams/:teamNumber", "routes/api.team.ts"),
	route("api/events", "routes/api.events.ts"),
	route("api/events/:league/:season/:eventCode", "routes/api.event.ts"),
	route("api/logs", "routes/api.logs.ts"),
	route("api/settings", "routes/api.settings.ts"),
	route("home", "routes/home.tsx"),
	route("compare", "routes/compare.tsx"),
	route("events", "routes/event-search.tsx"),
	route("settings", "routes/settings.tsx"),
	route("events/:league/:season/:eventCode", "routes/event-detail.tsx"),
	route("terms-of-service", "routes/terms-of-service.tsx"),
] satisfies RouteConfig;

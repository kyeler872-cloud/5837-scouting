import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/sign-in.tsx"),
	route("home", "routes/home.tsx"),
	route("terms-of-service", "routes/terms-of-service.tsx"),
] satisfies RouteConfig;

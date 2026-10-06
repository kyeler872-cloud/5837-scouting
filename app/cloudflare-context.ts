import { createContext } from "react-router";

export type CloudflareContext = {
	env: Env;
	ctx: ExecutionContext;
};

declare module "react-router" {
	interface RouterContextProvider {
		cloudflare: CloudflareContext;
	}
}

export const cloudflareContext = createContext<CloudflareContext>();

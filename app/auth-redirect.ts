export function getSafeAuthRedirectUrl(value: string | null, fallback = "/onboarding") {
	if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
		return fallback;
	}

	return value;
}

const CONTRIBUTOR_NAME_KEY = "scouting-contributor-name";
const CONTRIBUTOR_EXPIRY_KEY = "scouting-contributor-expires-at";

export function validateContributorName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim();
	return name && name.length <= 80 && !/[\r\n\0]/.test(name) ? name : null;
}

export function readContributorName(requireExpiry = false) {
	const name = validateContributorName(window.localStorage.getItem(CONTRIBUTOR_NAME_KEY));
	const storedExpiry = window.localStorage.getItem(CONTRIBUTOR_EXPIRY_KEY);
	const expiresAt = storedExpiry ? Number(storedExpiry) : null;
	if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
		window.localStorage.removeItem(CONTRIBUTOR_NAME_KEY);
		window.localStorage.removeItem(CONTRIBUTOR_EXPIRY_KEY);
		return null;
	}
	if (requireExpiry && expiresAt === null) return null;
	return name;
}

export function saveContributorName(value: unknown, expiresInSeconds = 31_536_000, requestedExpiresAt?: number) {
	const name = validateContributorName(value);
	if (!name) throw new Error("Enter a name from 1 to 80 characters.");
	const expiresAt = requestedExpiresAt ?? Date.now() + expiresInSeconds * 1000;
	window.localStorage.setItem(CONTRIBUTOR_NAME_KEY, name);
	window.localStorage.setItem(CONTRIBUTOR_EXPIRY_KEY, String(expiresAt));
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie = `scouting-contributor-name=${encodeURIComponent(name)}; Path=/; Max-Age=${expiresInSeconds}; SameSite=Lax${secure}`;
	document.cookie = `scouting-contributor-expires-at=${expiresAt}; Path=/; Max-Age=${expiresInSeconds}; SameSite=Lax${secure}`;
	window.dispatchEvent(new CustomEvent("scouting-contributor-updated", { detail: { expiresAt } }));
	return name;
}

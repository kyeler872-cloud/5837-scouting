const CONTRIBUTOR_NAME_KEY = "scouting-contributor-name";

export function validateContributorName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim();
	return name && name.length <= 12 && !/[\r\n\0]/.test(name) ? name : null;
}

export function readContributorName() {
	return validateContributorName(window.localStorage.getItem(CONTRIBUTOR_NAME_KEY));
}

export function saveContributorName(value: unknown) {
	const name = validateContributorName(value);
	if (!name) throw new Error("Enter a name from 1 to 12 characters.");
	window.localStorage.setItem(CONTRIBUTOR_NAME_KEY, name);
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie = `scouting-contributor-name=${encodeURIComponent(name)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
	return name;
}

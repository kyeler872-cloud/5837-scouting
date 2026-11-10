export type NoteAttribution = {
	text: string;
	contributorId: string;
	contributorName: string;
};

export type AttributedNoteDocument = {
	content: string;
	attributions: NoteAttribution[];
};

export function noteAttributionColor(contributorId: string, contributorName: string) {
	const identity = contributorId || contributorName;
	let hash = 0;
	for (const character of identity) hash = (hash * 31 + character.charCodeAt(0)) | 0;
	return `hsl(${Math.abs(hash) % 360} 72% 48% / 35%)`;
}

export function parseNoteAttributions(value: string, content: string): NoteAttribution[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("Saved note attribution data is invalid.");
	const attributions = parsed.map((item): NoteAttribution => {
		if (
			typeof item !== "object" || item === null ||
			!("text" in item) || typeof item.text !== "string" ||
			!("contributorId" in item) || typeof item.contributorId !== "string" ||
			!("contributorName" in item) || typeof item.contributorName !== "string"
		) throw new Error("Saved note attribution data is invalid.");
		return { text: item.text, contributorId: item.contributorId, contributorName: item.contributorName };
	});
	if (attributions.map((item) => item.text).join("") !== content) throw new Error("Saved note attribution does not match its text.");
	return attributions;
}

export function updateNoteAttributions(
	previous: AttributedNoteDocument,
	nextContent: string,
	contributorId: string,
	contributorName: string,
): NoteAttribution[] {
	const oldCharacters = [...previous.content];
	const newCharacters = [...nextContent];
	const oldAttributions = previous.attributions.flatMap((attribution) =>
		[...attribution.text].map((text) => ({ text, contributorId: attribution.contributorId, contributorName: attribution.contributorName })),
	);
	if (oldAttributions.length !== oldCharacters.length) throw new Error("Saved note attribution does not match its text.");

	const maximumEditDistance = Math.min(oldCharacters.length + newCharacters.length, 256);
	const frontier = new Map<number, number>([[1, 0]]);
	const trace: Map<number, number>[] = [];
	let editDistance = -1;

	for (let distance = 0; distance <= maximumEditDistance; distance += 1) {
		trace.push(new Map(frontier));
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const previousX = frontier.get(diagonal - 1) ?? -1;
			const nextX = frontier.get(diagonal + 1) ?? -1;
			let x = diagonal === -distance || (diagonal !== distance && previousX < nextX)
				? Math.max(0, nextX)
				: Math.max(0, previousX + 1);
			let y = x - diagonal;
			while (x < oldCharacters.length && y < newCharacters.length && oldCharacters[x] === newCharacters[y]) {
				x += 1;
				y += 1;
			}
			frontier.set(diagonal, x);
			if (x >= oldCharacters.length && y >= newCharacters.length) {
				editDistance = distance;
				break;
			}
		}
		if (editDistance >= 0) break;
	}

	if (editDistance < 0) {
		let prefixLength = 0;
		while (
			prefixLength < oldCharacters.length &&
			prefixLength < newCharacters.length &&
			oldCharacters[prefixLength] === newCharacters[prefixLength]
		) prefixLength += 1;
		let suffixLength = 0;
		while (
			suffixLength < oldCharacters.length - prefixLength &&
			suffixLength < newCharacters.length - prefixLength &&
			oldCharacters[oldCharacters.length - suffixLength - 1] === newCharacters[newCharacters.length - suffixLength - 1]
		) suffixLength += 1;
		const result = [
			...oldAttributions.slice(0, prefixLength),
			...newCharacters.slice(prefixLength, newCharacters.length - suffixLength)
				.map((text) => ({ text, contributorId, contributorName })),
			...oldAttributions.slice(oldAttributions.length - suffixLength),
		];
		return mergeNoteAttributions(result);
	}

	const result: NoteAttribution[] = [];
	let x = oldCharacters.length;
	let y = newCharacters.length;
	for (let distance = editDistance; distance >= 0; distance -= 1) {
		const previousFrontier = trace[distance];
		const diagonal = x - y;
		const previousDiagonal = diagonal === -distance ||
			(diagonal !== distance && (previousFrontier.get(diagonal - 1) ?? -1) < (previousFrontier.get(diagonal + 1) ?? -1))
			? diagonal + 1
			: diagonal - 1;
		const previousX = distance === 0 ? 0 : previousFrontier.get(previousDiagonal) ?? 0;
		const previousY = previousX - previousDiagonal;
		while (x > previousX && y > previousY) {
			result.push(oldAttributions[x - 1]);
			x -= 1;
			y -= 1;
		}
		if (distance > 0) {
			if (x === previousX) {
				result.push({ text: newCharacters[y - 1], contributorId, contributorName });
				y -= 1;
			} else {
				x -= 1;
			}
		}
	}
	return mergeNoteAttributions(result.reverse());
}

function mergeNoteAttributions(attributions: NoteAttribution[]): NoteAttribution[] {
	const merged: NoteAttribution[] = [];
	for (const attribution of attributions) {
		const previous = merged[merged.length - 1];
		if (previous && previous.contributorId === attribution.contributorId && previous.contributorName === attribution.contributorName) {
			previous.text += attribution.text;
		} else {
			merged.push({ ...attribution });
		}
	}
	return merged.filter((attribution) => attribution.text.length > 0);
}

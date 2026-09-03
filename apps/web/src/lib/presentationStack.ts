export type ErrorPresentationLayer = {
	key: string;
	kind: "issue" | "occurrence";
	resourceId: string;
	path: string;
	parentPath: string;
};

export type ParsedErrorPresentationStack =
	| { valid: true; layers: ErrorPresentationLayer[] }
	| { valid: false; layers: [] };

export type VisiblePresentationLayer = {
	layer: ErrorPresentationLayer;
	depth: number;
	isTop: boolean;
};

const trimTrailingSlash = (path: string): string => path.replace(/\/+$/, "");

/**
 * Parse the recursive portion of the errors URL into an ordered presentation
 * history. The URL, rather than component state, remains the source of truth.
 */
export function parseErrorPresentationStack(
	basePath: string,
	splat: string | undefined,
): ParsedErrorPresentationStack {
	const base = trimTrailingSlash(basePath);
	if (!splat) return { valid: true, layers: [] };

	const segments = splat.split("/");
	if (
		segments.some((segment) => segment.length === 0) ||
		segments.length % 2 === 0
	) {
		return { valid: false, layers: [] };
	}

	const issueId = segments[0];
	if (!issueId) return { valid: false, layers: [] };

	const issuePath = `${base}/${encodeURIComponent(issueId)}`;
	const layers: ErrorPresentationLayer[] = [
		{
			key: `issue:${issueId}`,
			kind: "issue",
			resourceId: issueId,
			path: issuePath,
			parentPath: base,
		},
	];

	let path = issuePath;
	for (let index = 1; index < segments.length; index += 2) {
		const segment = segments[index];
		const occurrenceId = segments[index + 1];
		if (segment !== "occurrences" || !occurrenceId) {
			return { valid: false, layers: [] };
		}

		path = `${path}/occurrences/${encodeURIComponent(occurrenceId)}`;
		layers.push({
			key: `occurrence:${(index - 1) / 2}:${occurrenceId}`,
			kind: "occurrence",
			resourceId: occurrenceId,
			path,
			parentPath: layers[layers.length - 1]?.path ?? base,
		});
	}

	return { valid: true, layers };
}

/** Keep the complete route history while limiting mounted sheets to three. */
export function getVisiblePresentationLayers(
	layers: ErrorPresentationLayer[],
	maximumVisible = 3,
): VisiblePresentationLayer[] {
	const visible = layers.slice(-Math.max(0, maximumVisible));
	return visible.map((layer, index) => ({
		layer,
		depth: visible.length - index - 1,
		isTop: index === visible.length - 1,
	}));
}

export type PersonPresentationLayer = {
	key: string;
	kind: "person" | "event";
	resourceId: string;
	path: string;
	parentPath: string;
};

export type ParsedPersonPresentationStack =
	| { valid: true; layers: PersonPresentationLayer[] }
	| { valid: false; layers: [] };

/**
 * Parse a person route into presentation layers. The person is always layer
 * zero; `events/:eventId` pairs stack event detail sheets on top (activity
 * rows link here instead of navigating away to the Events explorer).
 */
export function parsePersonPresentationStack(
	basePath: string,
	personId: string | undefined,
	splat: string | undefined,
): ParsedPersonPresentationStack {
	const base = trimTrailingSlash(basePath);
	if (!personId) return { valid: false, layers: [] };

	const personPath = `${base}/${encodeURIComponent(personId)}`;
	const layers: PersonPresentationLayer[] = [
		{
			key: `person:${personId}`,
			kind: "person",
			resourceId: personId,
			path: personPath,
			parentPath: base,
		},
	];

	if (!splat) return { valid: true, layers };

	const segments = splat.split("/");
	if (
		segments.some((segment) => segment.length === 0) ||
		segments.length % 2 !== 0
	) {
		return { valid: false, layers: [] };
	}

	let path = personPath;
	for (let index = 0; index < segments.length; index += 2) {
		const segment = segments[index];
		const eventId = segments[index + 1];
		if (segment !== "events" || !eventId) {
			return { valid: false, layers: [] };
		}

		path = `${path}/events/${encodeURIComponent(eventId)}`;
		layers.push({
			key: `event:${index / 2}:${eventId}`,
			kind: "event",
			resourceId: eventId,
			path,
			parentPath: layers[layers.length - 1]?.path ?? base,
		});
	}

	return { valid: true, layers };
}

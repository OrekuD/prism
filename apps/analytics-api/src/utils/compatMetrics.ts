/**
 * Task 29: bounded compatibility-rejection counters.
 *
 * Counts only stable reason codes — never rejected payloads, credentials,
 * or key material. Mirrors the page-view counter pattern so operators can
 * see cross-family misuse without reading request bodies.
 */
const counters = new Map<string, number>();

export function recordCompatRejection(code: string): void {
	counters.set(code, (counters.get(code) ?? 0) + 1);
}

export function compatSnapshot(): Record<string, number> {
	return Object.fromEntries(counters);
}

export function resetCompatCounters(): void {
	counters.clear();
}

/**
 * Internal client seams (Task 17 §2/§3).
 *
 * These capabilities exist so @prism-analytics/browser can own Web
 * navigation and page-session behavior without widening the PUBLIC
 * PrismClient surface. They are symbol-keyed: application code cannot
 * discover or invoke them through normal property access, and the public
 * contract never documents them. The Browser package imports the symbol
 * from Core — one runtime dependency boundary, no hidden dynamic import.
 */

export const INTERNAL_SEAM = Symbol("prism.internalSeams");

/** A validated, consent-gated reserved analytics event result. */
export type ReservedEventResult =
	| { readonly status: "queued"; readonly eventId: string }
	| { readonly status: "rejected"; readonly reason: string }
	| { readonly status: "dropped"; readonly reason: string };

export interface InternalClientSeam {
	/**
	 * Creates an SDK-owned reserved event (`$prism_*`). Skips the public
	 * reserved-name rejection but enforces EVERYTHING else: structural name
	 * rules, strict JSON, sanitization/redaction, consent state, queue
	 * capacity, and — for `$prism_page_view` — the frozen wire-property
	 * schema from page-view.ts. Malformed input returns `rejected`, never a
	 * silent custom event.
	 */
	createReservedEvent(
		name: string,
		properties?: Record<string, unknown>,
	): ReservedEventResult;

	/**
	 * Attaches a validated client-owned Web session without emitting a
	 * second `session_started` (hard-navigation resume). A later explicit
	 * end still emits `session_ended`. Application code has no equivalent.
	 */
	resumeWebSession(session: {
		sessionId: string;
		startedAt: number;
	}): void;

	/** Clears any attached Web session without emitting `session_ended`
	 * (consent withdrawal / reset path). */
	detachWebSession(): void;
}

export type ClientWithInternalSeam = {
	readonly [INTERNAL_SEAM]?: InternalClientSeam;
};

export function internalSeam(client: unknown): InternalClientSeam | null {
	const seam = (client as Record<symbol, unknown>)?.[INTERNAL_SEAM];
	return seam ? (seam as InternalClientSeam) : null;
}

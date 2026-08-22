import {
	type CaptureResult,
	INTERNAL_SEAM,
	type InternalClientSeam,
	PAGE_VIEW_EVENT_NAME,
	PAGE_VIEW_LIMITS,
	type PageViewCandidate,
	type PageViewNavigation,
	type PrismClient,
} from "@prism-analytics/core";
import type { BrowserPageViewOptions } from "@prism-analytics/core";

/**
 * Web page-view tracking for @prism-analytics/browser (Task 17 §2–§4).
 *
 * Browser owns URL access, History listeners, page-session storage, and
 * lifecycle behavior; Core stays runtime-neutral. Everything flows through
 * the existing consent/queue/batch/retry lane as reserved
 * `$prism_page_view` events — there is no second delivery path.
 *
 * Privacy invariants (Task 17 §4):
 * - host = lowercase `location.hostname`; path = `location.pathname` only.
 *   Never the full URL, query string, or hash (hash routers normalize their
 *   own route through manual mode).
 * - Referrer is document.referrer's HOST only, external-only (same-host is
 *   internal traffic, never acquisition).
 * - Campaigns read ONLY the configured UTM allowlist keys from the query.
 * - Nothing is captured or retained while consent is pending/denied;
 *   denial clears persisted page-session state.
 */

/** Persisted per-tab page-session state (sessionStorage scoped). */
interface StoredWebSession {
	v: 1;
	sessionId: string;
	startedAt: number;
	lastActivityAt: number;
	sequence: number;
}

/** Typed dropped result (DropReason is a closed union in the contract). */
function dropped(reason: string): CaptureResult {
	return { status: "dropped", reason } as CaptureResult;
}

function hashString(input: string): string {
	let h = 2166136261;
	for (let i = 0; i < input.length; i += 1) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

function safeSessionStorage(): Storage | null {
	try {
		const probe = "__prism_probe__";
		window.sessionStorage.setItem(probe, "1");
		window.sessionStorage.removeItem(probe);
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function stableId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `wsess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Reference-counted History patch — ONE patch per browser context     */
/* shared by every live tracker; native methods restored when the      */
/* final tracker shuts down.                                           */
/* ------------------------------------------------------------------ */

type HistoryListener = (navigation: PageViewNavigation) => void;

interface HistoryPatch {
	count: number;
	originalPush: History["pushState"];
	originalReplace: History["replaceState"];
	listeners: Set<HistoryListener>;
}

let historyPatch: HistoryPatch | null = null;

function notify(navigation: PageViewNavigation): void {
	if (!historyPatch) return;
	for (const listener of [...historyPatch.listeners]) {
		try {
			listener(navigation);
		} catch {
			// A broken listener can never break application navigation.
		}
	}
}

function acquireHistoryPatch(listener: HistoryListener): () => void {
	if (!historyPatch) {
		const originalPush = window.history.pushState.bind(window.history);
		const originalReplace = window.history.replaceState.bind(window.history);
		const patch: HistoryPatch = {
			count: 0,
			originalPush,
			originalReplace,
			listeners: new Set(),
		};
		window.history.pushState = function patchedPush(
			this: History,
			...args: Parameters<History["pushState"]>
		) {
			const result = originalPush.apply(this, args);
			notify("push");
			return result;
		} as History["pushState"];
		window.history.replaceState = function patchedReplace(
			this: History,
			...args: Parameters<History["replaceState"]>
		) {
			const result = originalReplace.apply(this, args);
			// replaceState alone does not change the canonical path view unless
			// the path differs — same-path updates are suppressed downstream.
			notify("replace");
			return result;
		} as History["replaceState"];
		window.addEventListener("popstate", () => notify("pop"));
		historyPatch = patch;
	}
	historyPatch.count += 1;
	historyPatch.listeners.add(listener);
	return () => {
		const current = historyPatch;
		if (!current) return;
		current.listeners.delete(listener);
		current.count -= 1;
		if (current.count <= 0) {
			// Final tracker detached — restore native History methods.
			window.history.pushState = current.originalPush;
			window.history.replaceState = current.originalReplace;
			historyPatch = null;
		}
	};
}

/* ------------------------------------------------------------------ */
/* The tracker                                                         */
/* ------------------------------------------------------------------ */

export interface BrowserPageViewController {
	readonly mode: "history" | "manual";
	/** Manual-mode capture; history mode rejects manual calls. Synchronous,
	 * track()-style result semantics. */
	capture(input?: {
		path?: string;
		title?: string;
	}): CaptureResult;
	/** Test/diagnostic surface: forces a fresh Web session on next capture. */
	resetForTests(): void;
}

export interface CreatePageTrackerArgs {
	client: PrismClient;
	options: BrowserPageViewOptions;
	sourceKey: string;
	endpoint: string;
}

export function createPageTracker(
	args: CreatePageTrackerArgs,
): BrowserPageViewController & { dispose(): void } {
	const { client, options } = args;
	const seam: InternalClientSeam | null =
		((client as unknown as Record<symbol, unknown>)[INTERNAL_SEAM] as
			| InternalClientSeam
			| undefined) ?? null;

	const storage = safeSessionStorage();
	const stateKey = `prism:web-session:${hashString(args.sourceKey)}:${hashString(args.endpoint)}`;

	let disposed = false;
	let removeHistory: (() => void) | null = null;
	// Same-host/path suppression WITHIN one JS lifetime (a genuine reload is
	// a fresh lifetime and always captures). Manual dedup collapses React
	// Strict Mode's synchronous double-effect.
	let lastCapturedPath: string | null = null;
	let lastManualSignature: string | null = null;
	let lastManualAt = 0;

	/* ---------------- Web-session state (per tab) ---------------- */

	function loadState(): StoredWebSession | null {
		if (!storage) return null;
		try {
			const raw = storage.getItem(stateKey);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as StoredWebSession;
			if (parsed?.v !== 1 || !parsed.sessionId) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	function saveState(state: StoredWebSession): void {
		if (!storage) return;
		try {
			storage.setItem(stateKey, JSON.stringify(state));
		} catch {
			// Storage denial degrades to in-memory sequencing only.
		}
	}

	function clearState(): void {
		if (!storage) return;
		try {
			storage.removeItem(stateKey);
		} catch {
			// ignore
		}
	}

	/**
	 * Resolves the active Web session for this capture:
	 * - resumed when persisted state exists and is inside the frozen
	 *   30-minute inactivity window (hard navigation / SPA continuation),
	 * - fresh otherwise (new tab, expired timeout, first ever view).
	 * Fresh sessions go through the PUBLIC startSession() so the normal
	 * `session_started` event ships exactly once; resumes attach through the
	 * internal seam without a second start event.
	 */
	function ensureWebSession(now: number): number {
		const stored = loadState();
		if (
			stored &&
			now - stored.lastActivityAt <=
				PAGE_VIEW_LIMITS.webSessionInactivityTimeoutMs
		) {
			seam?.resumeWebSession({
				sessionId: stored.sessionId,
				startedAt: stored.startedAt,
			});
			const sequence = stored.sequence + 1;
			saveState({ ...stored, lastActivityAt: now, sequence });
			return sequence;
		}
		// New Web session: public start emits session_started once.
		const handle = client.startSession();
		const sessionId =
			handle.status === "started" ? handle.session.sessionId : stableId(); // blocked (shutdown/pending handled upstream) fallback
		const startedAt = now;
		saveState({
			v: 1,
			sessionId,
			startedAt,
			lastActivityAt: now,
			sequence: 1,
		});
		return 1;
	}

	/* ---------------- Candidate construction (privacy-bounded) -------- */

	function buildCandidate(
		navigation: PageViewNavigation,
		override?: { path?: string; title?: string },
	): PageViewCandidate | null {
		let host = "";
		let path = "/";
		try {
			host = window.location.hostname.toLowerCase();
			path = window.location.pathname || "/";
		} catch {
			return null;
		}
		if (override?.path && override.path.startsWith("/")) {
			path = override.path;
		}
		if (!host || !isValidPath(path)) return null;

		const stored = loadState();
		const candidate: PageViewCandidate = {
			host,
			path,
			navigation,
			sequence: stored ? stored.sequence + 1 : 1,
			...(stored && lastCapturedPath ? { previousPath: lastCapturedPath } : {}),
			...(options.captureTitle
				? {
						title: (override?.title ?? documentTitle()).slice(
							0,
							PAGE_VIEW_LIMITS.maxTitleLength,
						),
					}
				: {}),
		};

		if (typeof options.beforeCapture === "function") {
			try {
				const next = options.beforeCapture(candidate);
				if (!next) return null; // developer dropped this view
				return next;
			} catch {
				// A throwing hook drops THIS view and never breaks navigation.
				return null;
			}
		}
		return candidate;
	}

	function isValidPath(path: string): boolean {
		return (
			path.startsWith("/") &&
			path.length <= PAGE_VIEW_LIMITS.maxPathLength &&
			!path.includes("?") &&
			!path.includes("#")
		);
	}

	function documentTitle(): string {
		try {
			return typeof document !== "undefined" ? (document.title ?? "") : "";
		} catch {
			return "";
		}
	}

	/** Referrer host — EXTERNAL only; same-host is internal navigation. */
	function externalReferrerHost(host: string): string | undefined {
		try {
			const raw = document.referrer;
			if (!raw) return undefined;
			const parsed = new URL(raw);
			const referrerHost = parsed.hostname.toLowerCase();
			if (!referrerHost || referrerHost === host) return undefined;
			return referrerHost.slice(0, PAGE_VIEW_LIMITS.maxAttributionValueLength);
		} catch {
			return undefined;
		}
	}

	/** Reads ONLY the allowlisted UTM keys; the rest of the query is never
	 * touched, stored, or logged. */
	function campaignFromQuery():
		| { source?: string; medium?: string; name?: string }
		| undefined {
		try {
			const search = window.location.search;
			if (!search) return undefined;
			const params = new URLSearchParams(search);
			const allow = new Set(
				options.campaignParameters ?? [
					"utm_source",
					"utm_medium",
					"utm_campaign",
				],
			);
			const bound = (key: string): string | undefined => {
				const value = params.get(key);
				if (!value) return undefined;
				return value.slice(0, PAGE_VIEW_LIMITS.maxAttributionValueLength);
			};
			const out: { source?: string; medium?: string; name?: string } = {};
			if (allow.has("utm_source")) out.source = bound("utm_source");
			if (allow.has("utm_medium")) out.medium = bound("utm_medium");
			if (allow.has("utm_campaign")) out.name = bound("utm_campaign");
			if (!out.source && !out.medium && !out.name) return undefined;
			return out;
		} catch {
			return undefined;
		}
	}

	/* ---------------- Delivery ------------------------------------ */

	function deliver(candidate: PageViewCandidate): CaptureResult {
		const now = Date.now();
		// Consent gate FIRST: pending/denied must not capture OR retain state.
		if (client.collectionState !== "granted") {
			return {
				status: "dropped",
				reason:
					client.collectionState === "pending"
						? "consent-pending"
						: "consent-denied",
			} as CaptureResult;
		}
		const sequence = ensureWebSession(now);
		const withSequence: PageViewCandidate = { ...candidate, sequence };
		lastCapturedPath = withSequence.path;

		const properties: Record<string, unknown> = {
			$page: {
				host: withSequence.host,
				path: withSequence.path,
				navigation: withSequence.navigation,
				sequence: withSequence.sequence,
				...(withSequence.previousPath
					? { previousPath: withSequence.previousPath }
					: {}),
				...(withSequence.title ? { title: withSequence.title } : {}),
			},
		};
		const referrer = externalReferrerHost(withSequence.host);
		if (referrer) properties.$referrer = { host: referrer };
		const campaign = campaignFromQuery();
		if (campaign) properties.$campaign = campaign;

		const result = seam?.createReservedEvent(PAGE_VIEW_EVENT_NAME, properties);
		if (!result) {
			return dropped("shutdown");
		}
		if (result.status === "queued") {
			return { status: "queued", eventId: result.eventId };
		}
		if (result.status === "rejected") {
			return { status: "dropped", reason: result.reason } as CaptureResult;
		}
		return { status: "dropped", reason: result.reason } as CaptureResult;
	}

	function captureNavigation(
		navigation: PageViewNavigation,
		override?: { path?: string; title?: string },
	): CaptureResult {
		if (disposed) {
			return dropped("shutdown");
		}
		const candidate = buildCandidate(navigation, override);
		if (!candidate) {
			return dropped("invalid-page-context");
		}
		// Same canonical host/path within this JS lifetime → not a page view
		// (React re-renders, replaceState churn). A reload is a new lifetime.
		if (
			candidate.path === lastCapturedPath &&
			(navigation === "replace" ||
				navigation === "push" ||
				navigation === "manual")
		) {
			return dropped("same-path-suppressed");
		}
		return deliver(candidate);
	}

	/* ---------------- Modes ---------------------------------------- */

	if (options.mode === "history") {
		removeHistory = acquireHistoryPatch((navigation) => {
			captureNavigation(navigation);
		});
		// Initial view fires exactly once per real page load.
		captureNavigation("initial");
	}

	/* ---------------- Controller ----------------------------------- */

	const controller: BrowserPageViewController & { dispose(): void } = {
		mode: options.mode,
		capture(input?: { path?: string; title?: string }): CaptureResult {
			if (disposed) {
				return dropped("shutdown");
			}
			if (options.mode === "history") {
				throw new Error(
					"pageViews.capture() is unavailable in history mode — navigation is captured automatically",
				);
			}
			// Client-level dedupe boundary: collapse synchronous duplicate manual
			// effects (React Strict Mode mount/unmount/remount) without collapsing
			// a genuine later return to the same route.
			const signature = `${window.location.hostname}|${input?.path ?? window.location.pathname}`;
			const now = Date.now();
			if (signature === lastManualSignature && now - lastManualAt < 500) {
				lastManualAt = now;
				return dropped("duplicate-manual-capture");
			}
			lastManualSignature = signature;
			lastManualAt = now;
			return captureNavigation("manual", input);
		},
		resetForTests(): void {
			clearState();
			lastCapturedPath = null;
			lastManualSignature = null;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			if (removeHistory) {
				removeHistory();
				removeHistory = null;
			}
			// Persisted state intentionally survives dispose-by-unload (that is
			// what makes hard navigations resume); tests use resetForTests().
		},
	};

	return controller;
}

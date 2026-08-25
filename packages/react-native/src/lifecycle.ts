import { MOBILE_SESSION_TIMEOUT_MS } from "@prism-analytics/core";
import { INTERNAL_SEAM } from "@prism-analytics/core";
import type {
	InternalClientSeam,
	PrismClient,
	PrismSessionHandle,
} from "@prism-analytics/core";
import {
	APP_LIFECYCLE_EVENT_NAME,
	SCREEN_VIEW_EVENT_NAME,
} from "@prism-analytics/core";
import { AppState } from "react-native";

/**
 * The ONE app-lifecycle / app-session owner (Task 18 slices 3-4; R2-F4,
 * R3-F4). Installed by the factory after Core resolves - never separately.
 *
 * Consent synchronization (R3-F4): the owner observes collection-state
 * transitions through the internal seam.
 *  - grant while foregrounded: creates a FRESH session + active observation
 *    immediately (no AppState round trip needed);
 *  - pending/denied: retains NO session or sequence state;
 *  - denied invalidates the local handle BEFORE any later foreground can
 *    resume the pre-withdrawal session.
 *
 * Session honesty: foreground time is observed; exact app close is NOT - a
 * background record closes the interval and process death ends observation
 * there. Inactivity beyond the frozen 30-minute window starts a NEW session
 * on the next foreground (the old one is ended honestly first); inside the
 * window the SAME session resumes through the internal seam without a
 * second session_started event.
 */
export interface AppLifecycleOwner {
	/** Stops observing and detaches session state exactly once. */
	dispose(): void;
}

export interface AppLifecycleOptions {
	/** Bounded app release metadata attached to reserved screen records. */
	app?: { version?: string; build?: string; environment?: string };
	now?: () => number;
}

export function installAppLifecycle(
	client: PrismClient,
	options: AppLifecycleOptions = {},
): AppLifecycleOwner {
	const seam = (client as unknown as Record<symbol, unknown>)[
		INTERNAL_SEAM
	] as InternalClientSeam | undefined;
	if (!seam) throw new Error("prism: internal seam unavailable");
	const s: InternalClientSeam = seam;
	const now = options.now ?? (() => Date.now());

	let session: PrismSessionHandle | null = null;
	let lastActiveAt = now();
	let sequence = 0;
	let disposed = false;
	let installationId: string | null = null;

	const refreshInstallation = (): void => {
		void seam
			.getInstallationId()
			.then((id) => {
				installationId = id;
			})
			.catch(() => {
				installationId = null;
			});
	};

	const emitLifecycle = (transition: "active" | "background", durationMs?: number) => {
		sequence += 1;
		s.createReservedEvent(APP_LIFECYCLE_EVENT_NAME, {
			$lifecycle: {
				transition,
				sequence,
				...(durationMs !== undefined ? { durationMs } : {}),
			},
		});
	};

	const clearLocalSession = (): void => {
		session = null;
		lastActiveAt = now();
	};

	const ensureSession = (): void => {
		if (disposed) return;
		// R3-F4: consent gates EVERYTHING. Pending/denied retains no state.
		if ((client as { state?: string }).state !== "granted") {
			clearLocalSession();
			return;
		}
		const t = now();
		if (session && t - lastActiveAt > MOBILE_SESSION_TIMEOUT_MS) {
			// Expired: close the old session honestly, then open a fresh one.
			try {
				session.end();
			} catch {
				// already ended elsewhere - never block the foreground path
			}
			session = null;
			sequence = 0;
		}
		if (!session) {
			// Consent-gated; emits exactly one session_started per session.
			const started = client.startSession();
			if (started.status === "started") session = started.session;
		} else {
			// Same-session resume WITHOUT a second session_started. Never
			// resumes across withdrawal: denial cleared `session` above via
			// the consent listener, so a stale handle cannot reattach.
			seam.resumeMobileSession({
				sessionId: session.sessionId,
				startedAt: session.startedAt,
				sequence,
			});
		}
		lastActiveAt = t;
	};

	const onForeground = (): void => {
		if (disposed) return;
		ensureSession();
		if (!session) return; // consent not granted - retain nothing
		emitLifecycle("active");
		void client.flush().catch(() => undefined);
	};

	const onBackground = (): void => {
		if (disposed || !session) return;
		const t = now();
		const durationMs = Math.max(0, t - lastActiveAt);
		lastActiveAt = t;
		emitLifecycle("background", durationMs);
		// Bounded best-effort flush on the way down.
		void client.flush().catch(() => undefined);
	};

	// R3-F4: reconcile IMMEDIATELY on consent transitions.
	const unsubState = seam.onCollectionStateChange((state) => {
		if (disposed) return;
		if (state === "granted") {
			refreshInstallation();
			onForeground();
		} else {
			// denied/pending: drop the local handle BEFORE any later
			// foreground; core already detached its side on denial.
			clearLocalSession();
			sequence = 0;
			if (state === "denied") installationId = null;
		}
	});

	const subscription = AppState.addEventListener("change", (state: string) => {
		if (disposed) return;
		if (state === "active") onForeground();
		if (state === "background") onBackground();
	});

	refreshInstallation();
	onForeground();

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubState();
			subscription.remove();
			if (session) {
				try {
					session.end();
				} catch {
					// ignore double-end
				}
				session = null;
			}
			seam.detachMobileSession();
		},
	};
}

/** Screen-record extras attached through the reserved lane only (R3-F3). */
export function screenExtras(
	client: PrismClient,
	app: AppLifecycleOptions["app"],
	installationId: string | null,
): Record<string, unknown> {
	void client;
	const extras: Record<string, unknown> = {};
	const appBlock: Record<string, unknown> = {};
	if (app?.version) appBlock.version = app.version;
	if (app?.build) appBlock.build = app.build;
	if (app?.environment) appBlock.environment = app.environment;
	if (Object.keys(appBlock).length > 0) extras.$app = appBlock;
	if (installationId) extras.$installation = installationId;
	return extras;
}

export { SCREEN_VIEW_EVENT_NAME };

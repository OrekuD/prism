import { MOBILE_SESSION_TIMEOUT_MS } from "@prism-analytics/core";
import { INTERNAL_SEAM } from "@prism-analytics/core";
import type { InternalClientSeam, PrismClient, PrismSessionHandle } from "@prism-analytics/core";
import { APP_LIFECYCLE_EVENT_NAME } from "@prism-analytics/core";
import { AppState } from "react-native";

/**
 * The ONE app-lifecycle / app-session owner (Task 18 slices 3-4, R2-F4).
 * Installed by the factory after Core is ready - never separately.
 *
 * Session honesty: foreground time is observed; exact app close is NOT -
 * a background record closes the interval, process death ends observation
 * there. Inactivity beyond the frozen 30-minute window starts a NEW app
 * session on the next foreground (old one ended honestly first); inside
 * the window the SAME session resumes through the internal seam without a
 * second session_started event.
 */
export interface AppLifecycleOwner {
	/** Stops observing and detaches session state exactly once. */
	dispose(): void;
}

export function installAppLifecycle(
	client: PrismClient,
	initialNow: () => number = () => Date.now(),
): AppLifecycleOwner {
	const seam = (client as unknown as Record<symbol, unknown>)[INTERNAL_SEAM] as
		| InternalClientSeam
		| undefined;
	const s = seam as InternalClientSeam;
	if (!seam) throw new Error("prism: internal seam unavailable");

	let session: PrismSessionHandle | null = null;
	let lastActiveAt = initialNow();
	let sequence = 0;
	let disposed = false;

	const emitLifecycle = (transition: "active" | "background") => {
		sequence += 1;
		s.createReservedEvent(APP_LIFECYCLE_EVENT_NAME, {
			$lifecycle: { transition, sequence },
		});
	};

	const ensureSession = (): void => {
		const now = initialNow();
		if (session && now - lastActiveAt > MOBILE_SESSION_TIMEOUT_MS) {
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
			// Same-session resume: attach WITHOUT a second session_started.
			s.resumeMobileSession({
				sessionId: session.sessionId,
				startedAt: session.startedAt,
				sequence,
			});
		}
		lastActiveAt = now;
	};

	onForeground();

	const subscription = AppState.addEventListener("change", (state: string) => {
		if (disposed) return;
		if (state === "active") onForeground();
		if (state === "background") onBackground();
	});

	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			subscription.remove();
			if (session) {
				try {
					session.end();
				} catch {
					// ignore double-end
				}
				session = null;
			}
			s.detachMobileSession();
		},
	};

	function onForeground() {
		ensureSession();
		emitLifecycle("active");
		void client.flush().catch(() => undefined);
	}

	function onBackground() {
		lastActiveAt = initialNow();
		sequence += 1;
		s.createReservedEvent(APP_LIFECYCLE_EVENT_NAME, {
			$lifecycle: { transition: "background", sequence },
		});
		// Bounded best-effort flush on the way down.
		void client.flush().catch(() => undefined);
	}
}
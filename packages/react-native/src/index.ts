import { createPrismClient } from "@prism-analytics/core";
import type {
	PrismClient,
	PrismRequest,
	PrismResponse,
	PrismRuntimeAdapter,
	PrismStorage,
} from "@prism-analytics/core";
import {
	MOBILE_LIMITS,
	SCREEN_VIEW_EVENT_NAME,
	APP_LIFECYCLE_EVENT_NAME,
} from "@prism-analytics/core";
import { Platform } from "react-native";
import { installAppLifecycle, type AppLifecycleOwner } from "./lifecycle";
import { createScreenController, type ScreenController } from "./screen";

export { MOBILE_LIMITS, SCREEN_VIEW_EVENT_NAME, APP_LIFECYCLE_EVENT_NAME };
export type { ScreenController, AppLifecycleOwner };
export { createScreenController, installAppLifecycle };

/** The ready client returned by the factory (Task 18 public contract). */
export interface ReactNativePrismClient extends PrismClient {
	/** Manual screen tracking bound to this client's internal seam. */
	screenViews: ScreenController;
	/** Disposes the app-lifecycle/session owner exactly once. */
	lifecycle: { dispose(): void };
}

export interface ReactNativePrismOptions {
	sourceKey: string;
	endpoint: string;
	/** Explicit durable storage - required for offline queue persistence. */
	storage?: PrismStorage;
	collection: { initialState: "granted" | "pending" | "denied" };
	anonymousPersistence?: "none" | "persistent";
	app?: { version?: string; build?: string; environment?: string };
	onDiagnostic?: (d: {
		level: string;
		code: string;
		message: string;
		timestamp: number;
	}) => void;
}

/**
 * Cryptographically secure ID generation (R2-F6/R1-F6): randomUUID where
 * available, getRandomValues otherwise - and a LOUD failure when neither
 * exists. Math.random() is never an acceptable identity source.
 */
function rnCreateId(): string {
	const g = globalThis as { crypto?: Crypto };
	if (g.crypto?.randomUUID) return g.crypto.randomUUID();
	if (!g.crypto?.getRandomValues) {
		throw new Error(
			"prism: no secure random available (crypto.getRandomValues required)",
		);
	}
	const b = new Uint8Array(16);
	g.crypto.getRandomValues(b);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
	return [
		h.slice(0, 8),
		h.slice(8, 12),
		h.slice(12, 16),
		h.slice(16, 20),
		h.slice(20),
	].join("-");
}

let owner: ReactNativePrismClient | null = null;
let lifecycleOwner: AppLifecycleOwner | null = null;

/**
 * Single-owner async factory (Task 18 slice 3). The app-lifecycle/session
 * owner installs ONLY after Core resolves; any initialization failure rolls
 * back the owner lock so the app can retry cleanly.
 */
export async function createReactNativeClient(
	opts: ReactNativePrismOptions,
): Promise<ReactNativePrismClient> {
	if (owner) throw new Error("prism: already initialized in this app");
	// Validate configuration BEFORE installing any listener.
	if (!opts.sourceKey || !opts.endpoint) {
		throw new Error("prism: sourceKey and endpoint are required");
	}
	const os = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : null;
	if (!os) throw new Error(`prism: unsupported platform ${String(Platform.OS)}`);

	try {
		const transport = {
			post: async (url: string, request: PrismRequest): Promise<PrismResponse> => {
				const controller = new AbortController();
				const onAbort = (): void => controller.abort();
				request.signal.addEventListener("abort", onAbort);
				const timer = setTimeout(() => controller.abort(), request.timeoutMs);
				try {
					const r = await fetch(url, {
						method: "POST",
						headers: { ...request.headers },
						body: request.body,
						signal: controller.signal,
					});
					return {
						status: r.status,
						headers: Object.fromEntries(r.headers.entries()),
						text: () => r.text(),
					};
				} finally {
					clearTimeout(timer);
					request.signal.removeEventListener("abort", onAbort);
				}
			},
		};		const runtime: PrismRuntimeAdapter = {
			name: "react-native",
			now: () => Date.now(),
			createId: rnCreateId,
			transport,
			...(opts.storage ? { storage: opts.storage } : {}),
			schedule: (delayMs, cb) => {
				const id = setTimeout(cb, delayMs);
				return () => clearTimeout(id);
			},
			context: {
				platform: "react-native",
				kind: "mobile",
				os,
			} as unknown as PrismRuntimeAdapter["context"],
		};
		const client = (await createPrismClient({
			sourceKey: opts.sourceKey,
			endpoint: opts.endpoint,
			collection: opts.collection,
			...(opts.anonymousPersistence
				? { anonymousPersistence: opts.anonymousPersistence }
				: {}),
			...(opts.onDiagnostic ? { onDiagnostic: opts.onDiagnostic } : {}),
			runtime,
		} as Parameters<typeof createPrismClient>[0])) as unknown as ReactNativePrismClient;

		// The ONE lifecycle/session owner - installed AFTER Core resolves.
		lifecycleOwner = installAppLifecycle(client);
		client.screenViews = createScreenController(client);
		client.lifecycle = {
			dispose() {
				lifecycleOwner?.dispose();
				lifecycleOwner = null;
				owner = null;
			},
		};
		owner = client;
		return client;
	} catch (error) {
		// Roll back the single-owner lock on ANY failure.
		owner = null;
		throw error;
	}
}

/** Test-only: force-clear the module owner between test files. */
export function __resetOwnerForTests(): void {
	lifecycleOwner?.dispose();
	lifecycleOwner = null;
	owner = null;
}

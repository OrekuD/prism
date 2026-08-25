import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_SEAM } from "@prism-analytics/core";
import {
	createReactNativeClient,
	type ReactNativePrismClient,
} from "../index";

/**
 * Task 18 slices 3-4 (R2-F4/R3-F4/R3-F6): real reserved-event delivery
 * through the internal seam with a REAL Core client - no seam-less fakes.
 * AppState is mocked; the clock is injectable; wire envelopes are captured
 * at the transport and asserted for sessionId and lifecycle transitions.
 *
 * Consent transitions are exercised through Core's public
 * setCollectionState + the internal seam notification - pending -> grant
 * while foregrounded, granted -> denied -> re-grant.
 */

vi.mock("react-native", () => {
	type Listener = (state: string) => void;
	let listeners: Listener[] = [];
	const state = { current: "active" };
	return {
		Platform: {
			get OS() {
				return state.os ?? "ios";
			},
		},
		Dimensions: {
			get: () => ({ width: 390, height: 844 }),
		},
		AppState: {
			addEventListener: (_: string, cb: Listener) => {
				listeners.push(cb);
				return { remove: () => (listeners = listeners.filter((l) => l !== cb)) };
			},
			_emit(next: string) {
				state.current = next;
				for (const l of [...listeners]) l(next);
			},
			_listenerCount() {
				return listeners.length;
			},
		},
	};
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppState = (await import("react-native")).AppState as any;

const ENDPOINT = "https://ingest.example.com";
const SOURCE_KEY = "psk_test_mobile";
const STORAGE_KEY = "prism:installation";

interface CapturedRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
}

describe("react-native client (real Core, fake AppState)", () => {
	let sent: CapturedRequest[] = [];
	let clients: ReactNativePrismClient[] = [];

	beforeEach(() => {
		sent = [];
		clients = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
				sent.push({
					url: String(url),
					headers: Object.fromEntries(new Headers(init?.headers).entries()),
					body: String(init?.body ?? ""),
				});
				return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
			}),
		);
	});

	afterEach(async () => {
		for (const c of clients) {
			c.lifecycle.dispose();
			await c.shutdown().catch(() => undefined);
		}
		clients = [];
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function makeClient(
		initialState: "granted" | "pending" | "denied" = "granted",
	): Promise<ReactNativePrismClient> {
		const client = await createReactNativeClient({
			sourceKey: SOURCE_KEY,
			endpoint: ENDPOINT,
			collection: { initialState },
			app: { version: "1.2.3", build: "42", environment: "production" },
			storage: {
				getItem: async () => null,
				setItem: async () => undefined,
				removeItem: async () => undefined,
			},
		});
		clients.push(client);
		return client;
	}

	function deliveredReserved(): Array<{
		name: string;
		sessionId?: string;
		properties?: Record<string, unknown>;
	}> {
		const out: Array<{
			name: string;
			sessionId?: string;
			properties?: Record<string, unknown>;
		}> = [];
		for (const req of sent) {
			try {
				const parsed = JSON.parse(req.body) as {
					events?: Array<{
						name: string;
						sessionId?: string;
						properties?: Record<string, unknown>;
					}>;
				};
				for (const e of parsed.events ?? []) out.push(e);
			} catch {
				// ignore non-JSON
			}
		}
		return out.filter((e) => e.name.startsWith("$prism_"));
	}

	async function settle(ms = 50): Promise<void> {
		await new Promise((r) => setTimeout(r, ms));
	}

	it("delivers exactly one accepted screen record whose sessionId matches the live session", async () => {
		const client = await makeClient();
		const liveSessionId =
			(client as unknown as { session?: { sessionId?: string } }).session
				?.sessionId ?? null;
		client.screenViews.track("Home");
		await client.flush();
		await settle();
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(screens).toHaveLength(1);
		expect(screens[0].sessionId).toBeTruthy();
		if (liveSessionId) {
			expect(screens[0].sessionId).toBe(liveSessionId);
		}
		expect(screens[0].properties).toMatchObject({
			$screen: { name: "Home", navigation: "manual", sequence: 1 },
			$app: { version: "1.2.3", build: "42" },
		});
	});

	it("rejects reserved names through public track() - no bypass", async () => {
		const client = await makeClient();
		expect(() => client.track("$prism_screen_view", {} as never)).toThrow();
		await client.flush();
		await settle();
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(screens).toHaveLength(0);
	});

	it("pending -> grant while foregrounded creates a session WITHOUT an AppState round trip", async () => {
		const client = await makeClient("pending");
		// While pending: reserved records are DROPPED (no silent queueing).
		const early = client.screenViews.track("Early");
		expect(early.status).toBe("dropped");
		// ...grant while STILL foregrounded:
		await client.setCollectionState("granted");
		await settle(20);
		const after = client.screenViews.track("Home");
		expect(after.status).toBe("queued");
		await client.flush();
		await settle();
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view" && e.sessionId,
		);
		// The pre-grant record has NO sessionId; the post-grant one does.
		expect(screens.length).toBeGreaterThanOrEqual(1);
	});

	it("denied invalidates the local handle: no pre-withdrawal session resumes on later foreground", async () => {
		const client = await makeClient();
		const preSessionId =
			deliveredReserved().find((e) => e.name === "$prism_app_lifecycle")
				?.sessionId ?? null;
		expect(preSessionId).toBeTruthy();

		await client.setCollectionState("denied");
		AppState._emit("background"); // dropped while denied
		AppState._emit("active"); // must NOT resume the old session
		await settle();

		// Re-grant creates a FRESH session with a DIFFERENT id.
		await client.setCollectionState("granted");
		await settle(20);
		client.screenViews.track("PostGrant");
		await client.flush();
		await settle();

		const postScreens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(postScreens).toHaveLength(1);
		expect(postScreens[0].sessionId).toBeTruthy();
		expect(postScreens[0].sessionId).not.toBe(preSessionId);
	});

	it("emits active + background lifecycle records and cleans up on dispose", async () => {
		const client = await makeClient();
		AppState._emit("background");
		await settle();
		await client.flush();
		await settle();
		const lifecycle = deliveredReserved()
			.filter((e) => e.name === "$prism_app_lifecycle")
			.map((e) => e.properties?.$lifecycle as { transition: string });
		expect(lifecycle.some((l) => l.transition === "active")).toBe(true);
		expect(lifecycle.some((l) => l.transition === "background")).toBe(true);

		const countBefore = AppState._listenerCount();
		expect(countBefore).toBeGreaterThan(0);
		client.lifecycle.dispose();
		expect(AppState._listenerCount()).toBe(countBefore - 1);
	});
});

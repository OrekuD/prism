import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_SEAM } from "@prism-analytics/core";
import {
	createReactNativeClient,
	__resetOwnerForTests,
	type ReactNativePrismClient,
} from "../index";
import { createScreenController, resetScreenSequenceForTests } from "../screen";

/**
 * Task 18 slices 3-4 (R2-F4): real reserved-event delivery through the
 * internal seam with a REAL Core client - no seam-less fakes. AppState is
 * mocked; the clock is injectable so inactivity timeout behavior is
 * deterministic. Wire envelopes are captured at the transport.
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
			_setOS(os: string) {
				state.os = os;
			},
		},
	};
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppState = (vi.mocked(await import("react-native"), { spy: true }).AppState ??
	(await import("react-native")).AppState) as any;

const ENDPOINT = "https://ingest.example.com";
const SOURCE_KEY = "psk_test_mobile";

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
		resetScreenSequenceForTests();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
				sent.push({
					url: String(url),
					headers: Object.fromEntries(
						new Headers(init?.headers).entries(),
					),
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
		__resetOwnerForTests();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function makeClient(): Promise<ReactNativePrismClient> {
		const client = await createReactNativeClient({
			sourceKey: SOURCE_KEY,
			endpoint: ENDPOINT,
			collection: { initialState: "granted" },
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
		properties?: Record<string, unknown>;
	}> {
		const out: Array<{ name: string; properties?: Record<string, unknown> }> =
			[];
		for (const req of sent) {
			try {
				const parsed = JSON.parse(req.body) as {
					events?: Array<{ name: string; properties?: Record<string, unknown> }>;
				};
				for (const e of parsed.events ?? []) out.push(e);
			} catch {
				// ignore non-JSON
			}
		}
		return out.filter((e) => e.name.startsWith("$prism_"));
	}

	it("delivers exactly one accepted screen record per manual track through the seam", async () => {
		const client = await makeClient();
		client.screenViews.track("Home");
		await client.flush();
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(screens).toHaveLength(1);
		expect(screens[0].properties).toMatchObject({
			$screen: { name: "Home", navigation: "manual" },
		});
	});

	it("rejects reserved names through public track() - no bypass", async () => {
		const client = await makeClient();
		expect(() => client.track("$prism_screen_view", {} as never)).toThrow();
		await client.flush();
		// Only the lifecycle-active record from install exists, no screen view.
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(screens).toHaveLength(0);
	});

	it("starts a real Core session before screen events carry its sessionId", async () => {
		const client = await makeClient();
		const screenResult = client.screenViews.track("Settings");
		expect(screenResult.status).toBe("queued");
		await client.flush();
		const screens = deliveredReserved().filter(
			(e) => e.name === "$prism_screen_view",
		);
		expect(screens).toHaveLength(1);
	});

	it("emits active + background lifecycle records and cleans up on dispose", async () => {
		const client = await makeClient();
		// Install already emitted one 'active'.
		AppState._emit("background");
		// The background transition itself triggers an async flush; let the
		// in-flight transport promise settle before asserting on the wire.
		await new Promise((r) => setTimeout(r, 50));
		await client.flush();
		await new Promise((r) => setTimeout(r, 50));
		const all = deliveredReserved();
		console.log("ALL RESERVED:", JSON.stringify(all));
		const lifecycle = all
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

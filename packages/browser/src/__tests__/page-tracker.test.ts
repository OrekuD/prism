import { INTERNAL_SEAM } from "@prism-analytics/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BrowserPrismClient, createBrowserClient } from "../index";

/**
 * Task 17 slice 2 — Browser page tracking: history/manual modes, per-tab
 * Web sessions across hard navigations, consent lifecycle, same-path
 * suppression, Strict-Mode dedupe, and reserved-event delivery through the
 * internal seam. jsdom provides window/history/sessionStorage; navigation
 * is driven by calling history.pushState/replaceState/back directly.
 */

const ENDPOINT = "https://ingest.example.com";
const SOURCE_KEY = "psk_test_web";

const liveClients: Array<BrowserPrismClient> = [];

function storageKeys(): string[] {
	const out: string[] = [];
	for (let i = 0; i < window.sessionStorage.length; i += 1) {
		const k = window.sessionStorage.key(i);
		if (k) out.push(k);
	}
	return out;
}

function webSessionKey(): string | null {
	return storageKeys().find((k) => k.startsWith("prism:web-session:")) ?? null;
}

function tick(ms = 20): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Captures reserved page-view payloads delivered through the internal seam. */
function seamSentinel(client: unknown): {
	sent: Array<{ name: string; properties?: Record<string, unknown> }>;
} {
	const sentinel = {
		sent: [] as Array<{ name: string; properties?: Record<string, unknown> }>,
	};
	const seam = (client as Record<symbol, unknown>)[INTERNAL_SEAM] as {
		createReservedEvent(name: string, props?: Record<string, unknown>): unknown;
	};
	const original = seam.createReservedEvent.bind(seam);
	seam.createReservedEvent = (name, props) => {
		if (name === "$prism_page_view") {
			sentinel.sent.push({ name, properties: props });
		}
		return original(name, props);
	};
	return sentinel;
}

async function makeClient(
	pageViews?: Parameters<typeof createBrowserClient>[0]["pageViews"],
): Promise<BrowserPrismClient> {
	const client = await createBrowserClient({
		sourceKey: SOURCE_KEY,
		endpoint: ENDPOINT,
		collection: { initialState: "granted", anonymousPersistence: "none" },
		pageViews,
	});
	liveClients.push(client);
	return client;
}

describe("browser page tracking", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		window.history.replaceState(null, "", "/");
	});

	afterEach(async () => {
		// Tear down every tracker so the module-level History patch/listeners
		// never leak across tests (ref-counted patch restores natively).
		for (const c of liveClients.splice(0)) {
			await c.shutdown({ timeoutMs: 200 }).catch(() => {});
		}
		window.sessionStorage.clear();
	});

	it("exposes pageViews: null when not configured", async () => {
		const client = await makeClient(undefined);
		expect(client.pageViews).toBeNull();
	});

	it("history mode captures push/replace/pop canonical changes; suppresses same-path updates", async () => {
		window.history.replaceState(null, "", "/first");
		const client = await makeClient({ mode: "history" });
		const sentinel = seamSentinel(client);

		window.history.replaceState(null, "", "/first"); // same-path → suppressed
		window.history.pushState(null, "", "/second");
		window.history.pushState(null, "", "/third");
		window.history.back(); // popstate back to /second — a real navigation
		await vi.waitFor(() => expect(sentinel.sent).toHaveLength(3));

		const paths = sentinel.sent.map(
			(e) => (e.properties?.$page as { path: string }).path,
		);
		expect(paths).toEqual(["/second", "/third", "/second"]);
		const navs = sentinel.sent.map(
			(e) => (e.properties?.$page as { navigation: string }).navigation,
		);
		expect(navs).toEqual(["push", "push", "pop"]);
		const page = sentinel.sent[0]!.properties!.$page as Record<string, unknown>;
		expect(page.host).toBe(window.location.hostname);
		const serialized = JSON.stringify(sentinel.sent);
		expect(serialized).not.toContain("?utm");
		expect(serialized).not.toContain("#");
	});

	it("resumes the SAME Web session across hard navigation; sequence continues", async () => {
		window.history.replaceState(null, "", "/a");
		const firstSeam = (await makeClient({
			mode: "history",
		})) as unknown as Record<symbol, unknown>;
		void firstSeam;

		window.history.pushState(null, "", "/b"); // sequence 2 in session #1
		await tick();

		const key = webSessionKey();
		expect(key).toBeTruthy();
		const stored = JSON.parse(window.sessionStorage.getItem(key!)!) as {
			sessionId: string;
			sequence: number;
		};
		expect(stored.sequence).toBe(2);

		// Hard navigation: the OLD lifetime dies (shutdown = tracker detach),
		// then a fresh client starts in the SAME tab.
		await liveClients.shift()!.shutdown({ timeoutMs: 200 });
		// Fresh lifetime's initial view resumes through the internal seam.
		const second = await makeClient({ mode: "history" });
		await tick();
		void second;

		const storedAfter = JSON.parse(
			window.sessionStorage.getItem(webSessionKey()!)!,
		) as { sequence: number; sessionId: string };
		expect(storedAfter.sessionId).toBe(stored.sessionId);
		expect(storedAfter.sequence).toBe(3); // continued, NOT restarted at 1

		window.history.replaceState(null, "", "/c");
		await tick();
		const storedNext = JSON.parse(
			window.sessionStorage.getItem(webSessionKey()!)!,
		) as { sequence: number };
		expect(storedNext.sequence).toBe(4);
	});

	it("manual mode installs no listeners and dedupes Strict-Mode double effects", async () => {
		const client = await makeClient({ mode: "manual" });
		const sentinel = seamSentinel(client);
		const beforePush = history.pushState;

		client.pageViews!.capture({ path: "/route-one" });
		client.pageViews!.capture({ path: "/route-one" }); // Strict remount
		window.history.pushState(null, "", "/ignored-by-manual");
		await tick();

		expect(history.pushState).toBe(beforePush); // no patch installed
		const paths = sentinel.sent.map(
			(e) => (e.properties!.$page as { path: string }).path,
		);
		expect(paths).toEqual(["/route-one"]);
		const navs = sentinel.sent.map(
			(e) => (e.properties!.$page as { navigation: string }).navigation,
		);
		expect(navs).toEqual(["manual"]);
	});

	it("history mode rejects manual capture; manual never auto-captures", async () => {
		const historyClient = await makeClient({ mode: "history" });
		expect(() => historyClient.pageViews!.capture({ path: "/x" })).toThrowError(
			/history mode/i,
		);

		const manualClient = await makeClient({ mode: "manual" });
		const sentinel = seamSentinel(manualClient);
		window.history.pushState(null, "", "/not-captured");
		await tick();
		expect(sentinel.sent).toHaveLength(0);
	});

	it("beforeCapture normalizes or drops views without breaking navigation", async () => {
		window.history.replaceState(null, "", "/users/secret-id-42/profile");
		const client = await makeClient({
			mode: "history",
			beforeCapture(page) {
				return {
					...page,
					path: page.path.replace(/\/users\/[^/]+/, "/users/:id"),
				};
			},
		});
		const sentinel = seamSentinel(client);
		window.history.pushState(null, "", "/users/other-77/settings");
		await tick();
		expect(sentinel.sent[0]!.properties!.$page).toMatchObject({
			path: "/users/:id/settings",
		});

		const dropping = await makeClient({
			mode: "history",
			beforeCapture: () => null,
		});
		const dropSentinel = seamSentinel(dropping);
		window.history.pushState(null, "", "/never-recorded");
		await tick();
		expect(dropSentinel.sent).toHaveLength(0);
	});

	it("pending consent captures nothing and retains NO web-session state", async () => {
		const pending = await createBrowserClient({
			sourceKey: SOURCE_KEY,
			endpoint: ENDPOINT,
			collection: { initialState: "pending", anonymousPersistence: "none" },
			pageViews: { mode: "history" },
		});
		liveClients.push(pending);
		window.history.pushState(null, "", "/while-pending");
		await tick();
		expect(webSessionKey()).toBeNull();
	});

	it("campaign allowlist reads ONLY configured UTM keys; never other params", async () => {
		window.history.replaceState(
			null,
			"",
			"/entry?utm_source=nl&utm_medium=email&utm_campaign=july&password=hunter2",
		);
		const client = await makeClient({
			mode: "manual",
			campaignParameters: ["utm_source", "utm_medium", "utm_campaign"],
		});
		const sentinel = seamSentinel(client);
		client.pageViews!.capture({ path: "/entry" }); // search still present
		await tick();
		expect(sentinel.sent.length).toBe(1);
		const serialized = JSON.stringify(sentinel.sent);
		expect(serialized).toContain('"nl"');
		expect(serialized).toContain('"email"');
		expect(serialized).toContain('"july"');
		expect(serialized).not.toContain("hunter2");
	});

	it("same-host referrer is internal: no $referrer on the wire", async () => {
		Object.defineProperty(document, "referrer", {
			value: `${window.location.origin}/somewhere`,
			configurable: true,
		});
		try {
			const client = await makeClient({ mode: "manual" });
			const sentinel = seamSentinel(client);
			client.pageViews!.capture({ path: "/internal-nav" });
			await tick();
			expect(sentinel.sent[0]!.properties!.$referrer).toBeUndefined();
		} finally {
			delete (document as { referrer?: string }).referrer;
		}
	});

	it("external referrer host is captured (host only)", async () => {
		Object.defineProperty(document, "referrer", {
			value: "https://google.com/search?q=secret",
			configurable: true,
		});
		try {
			const client = await makeClient({ mode: "manual" });
			const sentinel = seamSentinel(client);
			client.pageViews!.capture({ path: "/from-search" });
			await tick();
			expect(sentinel.sent[0]!.properties!.$referrer).toEqual({
				host: "google.com",
			});
			const serialized = JSON.stringify(sentinel.sent[0]);
			expect(serialized).not.toContain("q=secret");
		} finally {
			delete (document as { referrer?: string }).referrer;
		}
	});

	it("shutdown detaches listeners; persisted state survives for resume", async () => {
		const client = await makeClient({ mode: "history" });
		window.history.pushState(null, "", "/before-shutdown");
		await tick();
		expect(webSessionKey()).toBeTruthy();
		await client.shutdown({ timeoutMs: 200 });
		// State intentionally survives shutdown-by-navigation.
		expect(webSessionKey()).toBeTruthy();
	});
});

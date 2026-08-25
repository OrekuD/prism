import { createBrowserClient } from "@prism-analytics/browser";
import {
	INTERNAL_SEAM,
	type InternalClientSeam,
	type PrismClient,
} from "@prism-analytics/core";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismProvider, usePrismPageView } from "../index";

/**
 * Task 17 slice 3 — `usePrismPageView` contract: manual-mode requirement,
 * one capture per route change (Strict Mode collapses), misuse errors.
 */

// Simpler typed helper to avoid the contorted return above.
function makeFakeHelper(): {
	client: PrismClient;
	captures: Array<{ path?: string; title?: string }>;
} {
	const captures: Array<{ path?: string; title?: string }> = [];
	const seam: Partial<InternalClientSeam> = {
		createReservedEvent: () => ({ status: "queued", eventId: "evt_test" }),
		resumeWebSession: () => {},
		detachWebSession: () => {},
	};
	const client = {
		collectionState: "granted",
		[INTERNAL_SEAM]: seam,
		pageViews: {
			mode: "manual" as const,
			capture: (input?: { path?: string; title?: string }) => {
				captures.push(input ?? {});
				return { status: "queued", eventId: "evt_page" };
			},
		},
	} as unknown as PrismClient & Record<symbol, unknown>;
	return { client: client as unknown as PrismClient, captures };
}

const liveClients: Array<{
	shutdown(o?: { timeoutMs?: number }): Promise<unknown>;
}> = [];

afterEach(async () => {
	for (const c of liveClients.splice(0)) {
		await c.shutdown({ timeoutMs: 200 }).catch(() => {});
	}
});

describe("usePrismPageView", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("captures once per route in Strict Mode (real Browser tracker dedupe)", async () => {
		// REAL browser client: the Strict-Mode dedupe boundary lives in the
		// tracker (client-level), not in this hook — prove it end to end.
		const client = await createBrowserClient({
			sourceKey: "psk_react_test",
			endpoint: "https://ingest.example.com",
			collection: { initialState: "granted", anonymousPersistence: "none" },
			pageViews: { mode: "manual" },
		});
		liveClients.push(client);
		const sentPaths: string[] = [];
		const seam = (client as unknown as Record<symbol, unknown>)[
			INTERNAL_SEAM
		] as InternalClientSeam;
		const original = seam.createReservedEvent.bind(seam);
		seam.createReservedEvent = (name, props) => {
			if (name === "$prism_page_view") {
				const page = (props as { $page: { path: string } }).$page;
				sentPaths.push(page.path);
			}
			return original(name, props);
		};

		let route = "/first";
		function Routes(): null {
			usePrismPageView({ path: route });
			return null;
		}
		const view = render(
			<StrictMode>
				<PrismProvider client={client}>
					<Routes />
				</PrismProvider>
			</StrictMode>,
		);
		expect(sentPaths).toEqual(["/first"]);

		route = "/second";
		view.rerender(
			<StrictMode>
				<PrismProvider client={client}>
					<Routes />
				</PrismProvider>
			</StrictMode>,
		);
		expect(sentPaths).toEqual(["/first", "/second"]);
	});

	it("throws outside a provider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		function Orphan(): null {
			usePrismPageView({ path: "/" });
			return null;
		}
		expect(() => render(<Orphan />)).toThrowError(/PrismProvider/);
		spy.mockRestore();
	});

	it("rejects a client without page tracking", () => {
		const plain = { collectionState: "granted" } as unknown as PrismClient;
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		function Page(): null {
			usePrismPageView({ path: "/" });
			return null;
		}
		expect(() =>
			render(
				<PrismProvider client={plain}>
					<Page />
				</PrismProvider>,
			),
		).toThrowError(/no page tracking/i);
		spy.mockRestore();
	});
});

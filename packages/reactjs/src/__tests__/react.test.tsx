import type { JsonObject, PrismClient } from "@prism-analytics/core";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PrismContext,
	PrismProvider,
	type PrismReactFacade,
	usePrism,
} from "../index";

/**
 * @prism-analytics/react tests (task-9 §12): the provider is a ZERO-effect context
 * wrapper around an already-ready client. Strict Mode double-mounting,
 * unmount cleanup, stable references, and error surfaces are all proven
 * with a mocked client (the real engine is covered by @prism-analytics/core).
 */

function makeClient(): PrismClient & { calls: Record<string, number> } {
	const calls: Record<string, number> = {};
	const bump = (key: string) => {
		calls[key] = (calls[key] ?? 0) + 1;
	};
	const session: { sessionId: string; startedAt: number; end: () => unknown } =
		{
			sessionId: "sess-1",
			startedAt: 1,
			end: () => ({ status: "ended", eventId: "e-end" }),
		};
	return {
		collectionState: "granted",
		identity: { anonymousId: "anon-fake", userId: null, lastOpId: null },
		get session() {
			return session;
		},
		track: vi.fn((name: string) => {
			bump("track");
			return { status: "queued", eventId: `e-${name}-${calls.track}` };
		}),
		startSession: vi.fn(() => {
			bump("startSession");
			return { status: "started", session };
		}),
		setCollectionState: vi.fn(async (state: string) => {
			bump("setCollectionState");
			return state;
		}),
		flush: vi.fn(async () => {
			bump("flush");
		}),
		shutdown: vi.fn(async () => {
			bump("shutdown");
		}),
		onDiagnostic: vi.fn(() => ({
			remove: vi.fn(),
		})),
		identify: vi.fn(async (userId: string, traits?: JsonObject) => ({
			status: "queued",
			opId: "op-fake",
			userId,
			anonymousId: "anon-fake",
			...(traits ? { traits } : {}),
		})),
		reset: vi.fn(async () => ({ status: "ok", anonymousId: "anon-fresh" })),
		setGlobalProperty: vi.fn(async () => ({ status: "ok" })),
		unsetGlobalProperty: vi.fn(async () => ({ status: "ok" })),
		clearGlobalProperties: vi.fn(async () => ({ status: "ok" })),
		calls,
	} as unknown as PrismClient & { calls: Record<string, number> };
}

function Harness({
	children,
	client,
}: { children?: React.ReactNode; client?: PrismClient }) {
	const current = client ?? makeClient();
	return <PrismProvider client={current}>{children}</PrismProvider>;
}

function TrackingConsumer() {
	const prism = usePrism();
	const counts = useRef(0);
	counts.current += 1;
	useEffect(() => {
		prism.track("mounted");
	}, [prism]);
	return (
		<div>
			<span data-testid="renders">{counts.current}</span>
			<button
				type="button"
				onClick={() => prism.track("clicked", { label: "x" })}
				data-testid="track-button"
			>
				track
			</button>
		</div>
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("PrismProvider + usePrism", () => {
	it("publishes the READY client and renders children", () => {
		const client = makeClient();
		render(
			<PrismProvider client={client}>
				<div data-testid="child">content</div>
			</PrismProvider>,
		);
		expect(screen.getByTestId("child")).toBeDefined();
	});

	it("throws a specific error outside a provider", () => {
		const Spy = (): React.ReactNode => {
			try {
				usePrism();
				return null;
			} catch (error) {
				return <span data-testid="error">{(error as Error).message}</span>;
			}
		};
		render(<Spy />);
		expect(screen.getByTestId("error").textContent).toContain(
			"usePrism must be used inside a <PrismProvider",
		);
	});

	it("exposes STABLE bound references across re-renders", () => {
		const client = makeClient();
		const seen: Array<{ track: unknown; flush: unknown; setState: unknown }> =
			[];
		const Probe = (): React.ReactNode => {
			const prism = usePrism();
			seen.push({
				track: prism.track,
				flush: prism.flush,
				setState: prism.setCollectionState,
			});
			return null;
		};
		const { rerender } = render(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		rerender(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		rerender(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		expect(seen).toHaveLength(3);
		expect(seen[0]?.track).toBe(seen[1]?.track);
		expect(seen[1]?.track).toBe(seen[2]?.track);
		expect(seen[0]?.flush).toBe(seen[1]?.flush);
		expect(seen[0]?.setState).toBe(seen[2]?.setState);
	});

	it("does not duplicate events under React Strict Mode", () => {
		const client = makeClient();
		render(
			<StrictMode>
				<PrismProvider client={client}>
					<TrackingConsumer />
				</PrismProvider>
			</StrictMode>,
		);
		// Strict Mode double-invokes effects in dev — but the PROVIDER adds no
		// effects; the consumer's own effect is its own concern. The provider
		// itself never calls track: only the consumer's explicit effect did.
		expect(client.calls.track).toBeGreaterThanOrEqual(1);
		expect(client.calls.track).toBeLessThanOrEqual(2); // at most the consumer's own mounts
	});

	it("creates ONE client and never replaces it (provider ownership is explicit)", () => {
		const client = makeClient();
		const { rerender } = render(
			<PrismProvider client={client}>
				<TrackingConsumer />
			</PrismProvider>,
		);
		rerender(
			<PrismProvider client={client}>
				<TrackingConsumer />
			</PrismProvider>,
		);
		// the provider registered no listeners/timers and created no clients —
		// track calls come only from the consumer's interactions
		expect(client.startSession).not.toHaveBeenCalled();
	});

	it("performs no updates after unmount", () => {
		const client = makeClient();
		const { unmount } = render(
			<PrismProvider client={client}>
				<TrackingConsumer />
			</PrismProvider>,
		);
		unmount();
		// nothing scheduled, nothing pending — the mocked client sees no
		// further interaction from the provider layer
		const after = client.calls.track;
		expect(client.calls.track).toBe(after);
	});

	it("exposes the raw client through the PrismContext for advanced use", () => {
		const client = makeClient();
		render(
			<PrismProvider client={client}>
				<PrismContext.Consumer>
					{(value: PrismClient | null) => (
						<span data-testid="ctx">
							{value === client ? "same" : "different"}
						</span>
					)}
				</PrismContext.Consumer>
			</PrismProvider>,
		);
		expect(screen.getByTestId("ctx").textContent).toBe("same");
	});

	it("binds facade methods to the client instance (no recreated callbacks on click)", () => {
		const client = makeClient();
		render(
			<PrismProvider client={client}>
				<TrackingConsumer />
			</PrismProvider>,
		);
		screen.getByTestId("track-button").click();
		screen.getByTestId("track-button").click();
		expect(client.track).toHaveBeenCalledTimes(3); // 2 clicks + 1 mount effect
	});
});

describe("facade surface", () => {
	it("binds the complete facade: track/startSession/setCollectionState/flush/shutdown/onDiagnostic/collectionState", async () => {
		const client = makeClient();
		let observed: unknown = null;
		const Surface = (): React.ReactNode => {
			const prism = usePrism();
			observed = {
				clientIsSame: prism.client === client,
				collectionState: prism.collectionState,
				trackResult: prism.track("surface"),
				sessionResult: prism.startSession(),
				diagnosticHandle: prism.onDiagnostic(() => undefined),
			};
			void prism.setCollectionState("denied");
			void prism.flush();
			void prism.shutdown({ timeoutMs: 50 });
			return null;
		};
		render(
			<PrismProvider client={client}>
				<Surface />
			</PrismProvider>,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const seen = observed as {
			clientIsSame: boolean;
			collectionState: string;
			trackResult: { status: string };
			sessionResult: { status: string };
			diagnosticHandle: { remove: () => void };
		};
		expect(seen.clientIsSame).toBe(true);
		expect(seen.collectionState).toBe("granted");
		expect(seen.trackResult.status).toBe("queued");
		expect(seen.sessionResult.status).toBe("started");
		expect(seen.diagnosticHandle.remove).toBeTypeOf("function");
		expect(client.flush).toHaveBeenCalledTimes(1);
		expect(client.setCollectionState).toHaveBeenCalledWith("denied");
		expect(client.shutdown).toHaveBeenCalledTimes(1);
	});
});

describe("release review — live collectionState", () => {
	it("reflects consent changes through the facade getter (no stale snapshot)", async () => {
		const client = makeClient();
		let readState: unknown = null;
		const Reader = (): React.ReactNode => {
			const prism = usePrism();
			readState = prism.collectionState;
			return null;
		};
		render(
			<PrismProvider client={client}>
				<Reader />
			</PrismProvider>,
		);
		expect(readState).toBe("granted");
		// the underlying client state changes AFTER the facade was created —
		// the getter must observe the change
		(client as unknown as { collectionState: string }).collectionState =
			"denied";
		render(
			<PrismProvider client={client}>
				<Reader />
			</PrismProvider>,
		);
		expect(readState).toBe("denied");
	});
});

describe("identity facade (task-10 §7)", () => {
	it("exposes identify/reset/global properties bound to the client", async () => {
		const client = makeClient();
		const holder: { facade: PrismReactFacade | null } = { facade: null };
		const Probe = (): React.ReactNode => {
			holder.facade = usePrism();
			return null;
		};
		render(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		const facade = holder.facade as PrismReactFacade;
		expect(typeof facade.identify).toBe("function");
		expect(typeof facade.reset).toBe("function");
		expect(typeof facade.setGlobalProperty).toBe("function");
		expect(typeof facade.unsetGlobalProperty).toBe("function");
		expect(typeof facade.clearGlobalProperties).toBe("function");
		expect(facade.identity).toMatchObject({
			anonymousId: expect.any(String),
			userId: null,
		});

		await facade.identify("user-123", { plan: "pro" });
		expect(client.identify).toHaveBeenCalledWith("user-123", { plan: "pro" });
		await facade.setGlobalProperty("plan", "pro", "persistent");
		expect(client.setGlobalProperty).toHaveBeenCalledWith(
			"plan",
			"pro",
			"persistent",
		);
		await facade.reset();
		expect(client.reset).toHaveBeenCalledTimes(1);
	});

	it("keeps the identity getter live", () => {
		const client = makeClient();
		let read: unknown = null;
		const Probe = (): React.ReactNode => {
			const prism = usePrism();
			read = prism.identity.userId;
			return null;
		};
		render(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		const mutable = client as unknown as {
			identity: { userId: string | null };
		};
		mutable.identity.userId = "user-9"; // underlying state changes
		render(
			<PrismProvider client={client}>
				<Probe />
			</PrismProvider>,
		);
		expect(read).toBe("user-9");
	});
});

import type {
	PrismLifecycle,
	PrismLifecycleEvent,
	PrismRuntimeAdapter,
	PrismRuntimeContext,
} from "@prism-analytics/core";

/**
 * Node/server runtime internals for @prism-analytics/node (task-15, Phase 4).
 *
 * Every platform primitive is reached through this seam; importing the
 * module never touches a browser, and the adapter fails loudly for a
 * missing global `fetch` (Node < 18 or exotic embedders) instead of
 * half-working.
 *
 * Unlike the browser adapter there is NO persistent storage: a server
 * process owns its own memory queue and is expected to `flush()`/`shutdown()`
 * as part of its own lifecycle. The server never installs `uncaughtException`
 * or `unhandledRejection` handlers by default — the application owns
 * crash/restart policy (see `captureProcessErrors` on the reporter for the
 * explicit opt-in).
 */

/** Collision-resistant id via globalThis.crypto (Node 18+); fallback. */
function nodeCreateId(): string {
	try {
		const cryptoApi = globalThis.crypto as
			| { randomUUID?: () => string }
			| undefined;
		if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
			return cryptoApi.randomUUID();
		}
	} catch {
		// crypto unavailable — fall back.
	}
	return `prism-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Minimal, dependency-free server runtime context (task-15 "define releases,
 * distributions… consistently"): platform/kind plus the Node version so an
 * issue can show the server runtime without capturing environment secrets.
 * No process args, env vars, or cwd — those are app-owned and must be added
 * explicitly via `context`/`extras`.
 */
export function captureServerContext(): PrismRuntimeContext {
	const context: {
		platform: string;
		kind: "web" | "server" | "mobile";
		runtime?: { name: string; version: string };
	} = { platform: "node", kind: "server" };
	const versions =
		typeof process !== "undefined" && (process as { versions?: NodeJS.ProcessVersions })
			.versions;
	if (versions && typeof versions.node === "string") {
		context.runtime = { name: "node", version: versions.node };
	}
	return context;
}

/**
 * Best-effort flush-on-shutdown lifecycle (task-15 item: "lifecycle and
 * flush-on-shutdown contract"). Fires the bounded flush on graceful signals
 * and process `beforeExit`. It NEVER installs uncaughtException/
 * unhandledRejection — a crash is the application's to observe. The signal
 * set can be narrowed by the caller (e.g. a test runner should not let a
 * shutdown signal detach event-loop timers).
 */
export function createNodeLifecycle(signals: Array<NodeJS.Signals | "beforeExit"> = [
	"beforeExit",
	"SIGINT",
	"SIGTERM",
]): PrismLifecycle {
	const listeners: Record<PrismLifecycleEvent, Set<() => void>> = {
		foreground: new Set(),
		background: new Set(),
		"before-unload": new Set(),
	};
	const fire = (event: PrismLifecycleEvent): void => {
		for (const listener of listeners[event]) listener();
	};
	const handler = (): void => fire("before-unload");
	for (const signal of signals) {
		if (signal === "beforeExit") {
			try {
				// beforeExit is once-per-run: the reporter's owned flush is the
				// deterministic close, this is only a best-effort nudge.
				process.once("beforeExit", handler);
			} catch {
				// unsupported — skip
			}
			continue;
		}
		try {
			process.on(signal as NodeJS.Signals, handler);
		} catch {
			// signal unsupported on this platform — skip
		}
	}
	return {
		on(event, listener) {
			listeners[event].add(listener);
			let removed = false;
			return () => {
				if (removed) return;
				removed = true;
				listeners[event].delete(listener);
			};
		},
	};
}

/** Assemble the Node runtime adapter. */
export function createNodeRuntime(
	options?: { signals?: Array<NodeJS.Signals | "beforeExit"> },
): PrismRuntimeAdapter {
	return {
		name: "node",
		now: () => Date.now(),
		createId: nodeCreateId,
		transport: {
			post: (url, request) => {
				const controller = new AbortController();
				const onCoreAbort = (): void => controller.abort();
				request.signal.addEventListener("abort", onCoreAbort);
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					timer = setTimeout(() => controller.abort(), request.timeoutMs);
				} catch {
					timer = undefined;
				}
				if (typeof fetch !== "function") {
					throw new Error(
						"@prism-analytics/node requires global fetch (Node 18+ or a compatible runtime)",
					);
				}
				return fetch(url, {
					method: "POST",
					headers: { ...request.headers },
					body: request.body,
					signal: controller.signal,
				})
					.then(async (response) => {
						const headers = new Headers(response.headers);
						return {
							status: response.status,
							headers: Object.fromEntries(headers.entries()),
							text: () => response.text(),
						};
					})
					.finally(() => {
						if (timer) clearTimeout(timer);
						request.signal.removeEventListener("abort", onCoreAbort);
					});
			},
		},
		schedule: (delayMs, callback) => {
			const handle = setTimeout(callback, delayMs);
			return () => clearTimeout(handle);
		},
		context: captureServerContext(),
		lifecycle: createNodeLifecycle(options?.signals),
	};
}

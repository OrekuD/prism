import {
	type PrismRequest,
	type PrismResponse,
	type PrismRuntimeAdapter,
	createPrismClient,
} from "../index";

/**
 * Shared capability-based fake runtime + factory helpers (task-10): the
 * same seam-shaped fakes used by the core behavior tests and the identity
 * contract tests.
 */

export function fakeRuntime(name = "node-fake"): PrismRuntimeAdapter {
	let id = 0;
	return {
		name,
		now: () => Date.now(),
		createId: () => `fake-id-${(id += 1)}`,
		transport: {
			post: async (
				_url: string,
				_request: PrismRequest,
			): Promise<PrismResponse> => ({
				status: 200,
				headers: { "content-type": "application/json" },
				text: async () => "",
			}),
		},
		storage: {
			getItem: async () => null,
			setItem: async () => undefined,
			removeItem: async () => undefined,
		},
		schedule: (delayMs: number, callback: () => void) => {
			const handle = setTimeout(callback, delayMs);
			return () => clearTimeout(handle);
		},
		context: { platform: "node", kind: "server" },
	};
}

export const base = {
	sourceKey: "pr_0123456789abcdef0123456789abcdef",
	endpoint: "https://analytics.example.com",
};

export async function ready(
	options: Partial<Parameters<typeof createPrismClient>[0]> = {},
) {
	return createPrismClient({
		...base,
		runtime: fakeRuntime(),
		collection: { initialState: "granted" },
		...options,
	});
}

export function memoryStorage(
	stored: Map<string, string>,
): PrismRuntimeAdapter["storage"] {
	return {
		getItem: async (key: string) => stored.get(key) ?? null,
		setItem: async (key: string, value: string) => {
			stored.set(key, value);
		},
		removeItem: async (key: string) => {
			stored.delete(key);
		},
	};
}

/** The storage key for `base` — mirrors the core's endpoint-hash djb2. */
export function queueKey(): string {
	let hash = 5381;
	for (let i = 0; i < base.endpoint.length; i += 1) {
		hash = (hash * 33) ^ base.endpoint.charCodeAt(i);
	}
	return `prism:queue:v2:${hash >>> 0}:${base.sourceKey}`;
}

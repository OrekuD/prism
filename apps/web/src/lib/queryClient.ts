import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Task 16 / F7: the shared query client lives in a DOM-free module so
 * tests and non-root entry points can import it without booting the app
 * (main.tsx owns createRoot; this module owns cache policy).
 *
 * Freshness defaults implement the workspace-switching investigation
 * (F5): cached revisits render immediately; maxAge-style restore windows
 * live in App.tsx's QueryPersistor.
 */
export const QUERY_CACHE_BUSTER = "v1";

export function getPersistKey(userId: string | null | undefined): string {
	return `prism-query-cache:${QUERY_CACHE_BUSTER}:${userId ?? "anon"}`;
}

export function clearPersistedCache(key?: string): void {
	try {
		if (key) {
			window.localStorage.removeItem(key);
		} else {
			const toRemove: string[] = [];
			for (let i = 0; i < window.localStorage.length; i += 1) {
				const k = window.localStorage.key(i);
				if (k?.startsWith("prism-query-cache")) toRemove.push(k);
			}
			for (const k of toRemove) window.localStorage.removeItem(k);
		}
	} catch {
		// ignore storage errors
	}
}

export function clearQueryClient(client: QueryClient): void {
	client.clear();
	clearPersistedCache();
}

export const client = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => {
			if (!query.meta?.error) return;
			toast.error(query.meta.error as string);
		},
	}),
	defaultOptions: {
		queries: {
			retry: 2,
			// F5: explicit freshness — cached revisits stay fresh without a blocking skeleton.
			staleTime: 1000 * 60 * 2, // 2 min for project directory
			gcTime: 1000 * 60 * 30, // 30 min
			refetchOnWindowFocus: false,
		},
	},
});

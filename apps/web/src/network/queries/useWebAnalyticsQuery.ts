import { axiosInstance } from "@/utils/axiosInstance";
import type { WebAnalyticsResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Typed client query for the Web-analytics read model (Task 17 slice 5).
 *
 * Stable cache key contains project + normalized filters + range so
 * membership/deletion/archive invalidation can target it exactly. The
 * freshness policy comes from the app defaults (staleTime 2m / gcTime 30m)
 * — revisiting the page within the window renders cached data instantly.
 */
export function webAnalyticsQueryKey(params: {
	slug: string;
	from: number;
	to: number;
	sourceIds?: string[];
	host?: string | null;
	path?: string | null;
	traffic?: "human" | "all";
}) {
	return [
		"workspace-project-web-analytics",
		params.slug,
		params.from,
		params.to,
		[...(params.sourceIds ?? [])].sort(),
		params.host ?? null,
		params.path ?? null,
		params.traffic ?? "human",
	] as const;
}

async function fetchWebAnalytics(
	slug: string,
	params: Omit<Parameters<typeof webAnalyticsQueryKey>[0], "slug">,
): Promise<WebAnalyticsResource> {
	const search = new URLSearchParams({
		from: String(params.from),
		to: String(params.to),
	});
	for (const id of params.sourceIds ?? []) search.append("sourceId", id);
	if (params.host) search.set("host", params.host);
	if (params.path) search.set("path", params.path);
	search.set("traffic", params.traffic ?? "human");
	const response = await axiosInstance.get<WebAnalyticsResource>(
		`/projects/${slug}/web-analytics?${search.toString()}`,
	);
	if (response.status === 200) return response.data;
	throw new Error("web_analytics_failed");
}

export function useWebAnalyticsQuery(params: {
	slug: string;
	from: number;
	to: number;
	sourceIds?: string[];
	host?: string | null;
	path?: string | null;
	traffic?: "human" | "all";
}) {
	return useQuery({
		queryKey: webAnalyticsQueryKey(params),
		queryFn: () =>
			fetchWebAnalytics(params.slug, {
				from: params.from,
				to: params.to,
				sourceIds: params.sourceIds,
				host: params.host,
				path: params.path,
				traffic: params.traffic,
			}),
		enabled: Boolean(params.slug) && params.to > params.from,
		refetchOnWindowFocus: false,
	});
}

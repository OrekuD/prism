import { axiosInstance } from "@/utils/axiosInstance";
import type { MobileAnalyticsResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Typed client query for the Mobile-analytics read model (Task 18 slice 7,
 * R1-F5/R2-F3): canonical v1 path through the credentialed axios instance,
 * normalized URL-backed filters, and a complete stable cache key so
 * membership/deletion/archive invalidation can target it exactly.
 */
export function mobileAnalyticsQueryKey(params: {
	slug: string;
	from: number;
	to: number;
	sourceIds?: string[];
	os?: "ios" | "android" | null;
	release?: string | null;
}) {
	return [
		"workspace-project-mobile-analytics",
		params.slug,
		params.from,
		params.to,
		[...(params.sourceIds ?? [])].sort(),
		params.os ?? null,
		params.release ?? null,
	] as const;
}

async function fetchMobileAnalytics(
	slug: string,
	params: Omit<Parameters<typeof mobileAnalyticsQueryKey>[0], "slug">,
): Promise<MobileAnalyticsResource> {
	const search = new URLSearchParams({
		from: String(params.from),
		to: String(params.to),
	});
	for (const id of params.sourceIds ?? []) search.append("sourceId", id);
	if (params.os) search.set("os", params.os);
	if (params.release) search.set("release", params.release);
	const response = await axiosInstance.get<MobileAnalyticsResource>(
		`/projects/${slug}/mobile-analytics?${search.toString()}`,
	);
	if (response.status === 200) return response.data;
	throw new Error("mobile_analytics_failed");
}

export function useMobileAnalyticsQuery(params: {
	slug: string;
	from: number;
	to: number;
	sourceIds?: string[];
	os?: "ios" | "android" | null;
	release?: string | null;
	enabled?: boolean;
}) {
	return useQuery({
		queryKey: mobileAnalyticsQueryKey(params),
		queryFn: () =>
			fetchMobileAnalytics(params.slug, {
				from: params.from,
				to: params.to,
				sourceIds: params.sourceIds,
				os: params.os ?? null,
				release: params.release ?? null,
			}),
		enabled:
			(params.enabled ?? true) &&
			Boolean(params.slug) &&
			params.to > params.from,
		refetchOnWindowFocus: false,
	});
}

import { axiosInstance } from "@/utils/axiosInstance";
import type { ErrorIssueResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Project-scoped issue list (task-15 slice 2 read API). The range selector
 * is part of the query argument: counts and delta are windowed server-side,
 * so switching 7d / 30d refetches genuinely different data.
 */
async function projectIssues(slug: string | undefined, range: string) {
	if (!slug) return [];
	const response = await axiosInstance.get(`/projects/${slug}/errors`, {
		params: { range },
	});
	if (response.status === 200) {
		return response.data as ErrorIssueResource[];
	}
	return [];
}

export function useIssuesQuery(slug: string | undefined, range: string) {
	return useQuery<ErrorIssueResource[]>({
		queryKey: ["project-issues", slug, range],
		queryFn: () => projectIssues(slug, range),
		enabled: Boolean(slug),
		refetchOnWindowFocus: false,
	});
}

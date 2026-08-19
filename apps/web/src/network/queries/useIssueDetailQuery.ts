import { axiosInstance } from "@/utils/axiosInstance";
import type { ErrorIssueDetailResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Issue-detail resource (task-15 detail API): summarized occurrences,
 * workflow activity, all-time counts, and release bounds. Fetched when the
 * issue Sheet is open; the issue header still renders from the list cache so
 * the Sheet opens instantly and mutations update it in place.
 */
async function projectIssueDetail(
	slug: string | undefined,
	issueId: string | undefined,
) {
	if (!slug || !issueId) return null;
	const response = await axiosInstance.get(
		`/projects/${slug}/errors/${issueId}`,
	);
	if (response.status === 200) {
		return response.data as ErrorIssueDetailResource;
	}
	return null;
}

export function useIssueDetailQuery(
	slug: string | undefined,
	issueId: string | undefined,
) {
	return useQuery({
		queryKey: ["project-issue-detail", slug, issueId],
		queryFn: () => projectIssueDetail(slug, issueId),
		enabled: Boolean(slug && issueId),
		refetchOnWindowFocus: false,
	});
}
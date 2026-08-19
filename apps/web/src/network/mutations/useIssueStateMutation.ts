import { axiosInstance } from "@/utils/axiosInstance";
import type {
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Issue workflow action (task-15 slice 2 workflow API): resolve / reopen /
 * stop ignoring. Optimistically updates every cached range variant of the
 * {"project-issues", slug} list and rolls back on failure.
 */
async function updateIssueState(
	slug: string,
	issueId: string,
	status: ErrorIssueStatus,
) {
	const response = await axiosInstance.patch(
		`/projects/${slug}/errors/${issueId}`,
		{
			status,
		},
	);
	return response.data as ErrorIssueResource;
}

const ISSUES_PREFIX = (slug: string | undefined) => ["project-issues", slug];

export function useIssueStateMutation(slug: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { issueId: string; status: ErrorIssueStatus }) =>
			updateIssueState(slug ?? "", input.issueId, input.status),
		onMutate: async (input) => {
			const prefix = ISSUES_PREFIX(slug);
			await queryClient.cancelQueries({ queryKey: prefix });
			// Snapshot every range variant (7d, 30d, …) so a failed write can
			// restore each one exactly.
			const previous = queryClient.getQueriesData<ErrorIssueResource[]>({
				queryKey: prefix,
			});
			queryClient.setQueriesData<ErrorIssueResource[]>(
				{ queryKey: prefix },
				(issues = []) =>
					(issues ?? []).map((issue) =>
						issue.id === input.issueId
							? { ...issue, status: input.status }
							: issue,
					),
			);
			return { previous };
		},
		onError: (_error, _input, context) => {
			for (const [key, data] of context?.previous ?? []) {
				queryClient.setQueryData(key, data);
			}
			toast.error("Could not update the issue");
		},
	});
}

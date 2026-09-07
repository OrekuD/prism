import { axiosInstance } from "@/utils/axiosInstance";
import type {
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { IssueListResult } from "@/network/queries/useIssuesQuery";

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
			const previous = queryClient.getQueriesData<IssueListResult>({
				queryKey: prefix,
			});
			queryClient.setQueriesData<IssueListResult>(
				{ queryKey: prefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: old.items.map((issue) =>
							issue.id === input.issueId
								? { ...issue, status: input.status }
								: issue,
						),
					};
				},
			);
			return { previous };
		},
		onError: (error, _input, context) => {
			for (const [key, data] of context?.previous ?? []) {
				queryClient.setQueryData(key, data);
			}
			// Surface the actual server reason for debugging (403, 429, etc.)
			const message =
				(error as { response?: { data?: { error?: { code?: string; message?: string } }; status?: number } })?.response
					?.data?.error?.message ??
				(error as { message?: string })?.message ??
				"Could not update the issue";
			const code =
				(error as { response?: { data?: { error?: { code?: string } } } })?.response
					?.data?.error?.code ?? "";
			const label = code ? `${code}: ${message}` : message;
			toast.error(label);
			// Also log for devtools
			console.error("[issue state] update failed", error);
		},
		onSuccess: (updated) => {
			// Ensure the cache reflects the server's authoritative row
			const prefix = ISSUES_PREFIX(slug);
			queryClient.setQueriesData<IssueListResult>(
				{ queryKey: prefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: old.items.map((issue) =>
							issue.id === updated.id ? updated : issue,
						),
					};
				},
			);
		},
	});
}

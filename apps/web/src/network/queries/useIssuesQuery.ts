import { axiosInstance } from "@/utils/axiosInstance";
import type { ErrorIssueResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Project-scoped, server-filtered issue list (task-15 Errors list). Filters
 * and range are part of the query arguments AND preserved in the URL by the
 * caller: switching a filter refetches genuinely different server data. The
 * server returns the first page of issues with an opaque `x-prism-next-cursor`
 * header for keyset pagination ("load more").
 */
export interface IssueListQuery {
	range: string;
	status?: string;
	level?: string;
	platform?: string;
	release?: string;
	q?: string;
}

export interface IssueListResult {
	items: ErrorIssueResource[];
	nextCursor: string | null;
}

async function projectIssues(
	slug: string | undefined,
	params: IssueListQuery,
): Promise<IssueListResult> {
	if (!slug) return { items: [], nextCursor: null };
	const response = await axiosInstance.get(`/projects/${slug}/errors`, {
		params: {
			range: params.range,
			...(params.status ? { status: params.status } : {}),
			...(params.level ? { level: params.level } : {}),
			...(params.platform ? { platform: params.platform } : {}),
			...(params.release ? { release: params.release } : {}),
			...(params.q && params.q.trim() ? { q: params.q.trim() } : {}),
		},
	});
	const nextCursor =
		(typeof response.headers["x-prism-next-cursor"] === "string" &&
			response.headers["x-prism-next-cursor"]) ||
		null;
	return {
		items: response.data as ErrorIssueResource[],
		nextCursor,
	};
}

export function useIssuesQuery(slug: string | undefined, params: IssueListQuery) {
	return useQuery<IssueListResult>({
		queryKey: [
			"project-issues",
			slug,
			params.range,
			params.status ?? "all",
			params.level ?? "all",
			params.platform ?? "all",
			params.release ?? "all",
			params.q?.trim() ?? "",
		],
		queryFn: () => projectIssues(slug, params),
		enabled: Boolean(slug),
		refetchOnWindowFocus: false,
	});
}

/** Fetch the next keyset page and append to an existing list (load more). */
export async function fetchIssuePage(
	slug: string | undefined,
	params: IssueListQuery,
	cursor: string,
): Promise<IssueListResult> {
	const response = await axiosInstance.get(`/projects/${slug}/errors`, {
		params: {
			range: params.range,
			cursor,
			...(params.status ? { status: params.status } : {}),
			...(params.level ? { level: params.level } : {}),
			...(params.platform ? { platform: params.platform } : {}),
			...(params.release ? { release: params.release } : {}),
			...(params.q && params.q.trim() ? { q: params.q.trim() } : {}),
		},
	});
	const nextCursor =
		(typeof response.headers["x-prism-next-cursor"] === "string" &&
			response.headers["x-prism-next-cursor"]) ||
		null;
	return {
		items: response.data as ErrorIssueResource[],
		nextCursor,
	};
}

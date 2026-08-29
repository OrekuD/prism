import { axiosInstance } from "@/utils/axiosInstance";
import type { EventResource } from "@prism-analytics/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

export type ProjectEventsParams = {
  q?: string;
  sourceId?: string;
  platformFamily?: "web" | "mobile" | "server";
  cursor?: string;
  limit?: number;
};

export type ProjectEventsPage = {
  events: EventResource[];
  nextCursor: string | null;
};

async function projectEvents(
  slug: string | undefined,
  params: ProjectEventsParams = {},
): Promise<ProjectEventsPage> {
  if (!slug) return { events: [], nextCursor: null };
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.sourceId) search.set("sourceId", params.sourceId);
  if (params.platformFamily) search.set("type", params.platformFamily);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const response = await axiosInstance.get(`/projects/${slug}/events${qs ? `?${qs}` : ""}`);

  if (response.status === 200) {
    const data = response.data as unknown;
    // New paginated shape: { events, nextCursor } + header
    if (data && typeof data === "object" && "events" in (data as Record<string, unknown>) && Array.isArray((data as { events: unknown }).events)) {
      const typed = data as { events: EventResource[]; nextCursor?: string | null };
      const headerCursor =
        typeof response.headers["x-prism-next-cursor"] === "string"
          ? (response.headers["x-prism-next-cursor"] as string)
          : null;
      return {
        events: typed.events,
        nextCursor: typed.nextCursor ?? headerCursor ?? null,
      };
    }
    // Legacy bounded array
    if (Array.isArray(data)) {
      return { events: data as EventResource[], nextCursor: null };
    }
  }
  return { events: [], nextCursor: null };
}

export function useProjectEventsQuery(
  slug: string | undefined,
  params: ProjectEventsParams = {},
) {
  return useQuery<ProjectEventsPage>({
    queryKey: ["project-events", slug, params.q ?? null, params.sourceId ?? null, params.platformFamily ?? null, params.cursor ?? null, params.limit ?? null],
    queryFn: () => projectEvents(slug, params),
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}

// Legacy helper for components that still expect an array (e.g., event-detail cache lookup).
// Keep it as a thin wrapper that returns just the events array from the page.
export function useProjectEventsArrayQuery(slug: string | undefined) {
  const page = useProjectEventsQuery(slug, { limit: 200 });
  return {
    ...page,
    data: page.data?.events,
  } as unknown as ReturnType<typeof useQuery<EventResource[]>>;
}

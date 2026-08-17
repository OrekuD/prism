import { axiosInstance } from "@/utils/axiosInstance";
import type {
  BreakdownResource,
  PeopleListResource,
  PersonDetailResource,
  TotalsResource,
} from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * People + baseline query hooks (task-10 §8) — the dashboard bindings for
 * the §5/§6 APIs.
 */

export function usePeopleQuery(slug: string | undefined, params: { cursor?: string; q?: string; limit?: number }) {
  return useQuery<PeopleListResource>({
    queryKey: ["people", slug, params.cursor, params.q],
    queryFn: async () => {
      const search = new URLSearchParams();
      if (params.cursor) search.set("cursor", params.cursor);
      if (params.q) search.set("q", params.q);
      if (params.limit) search.set("limit", String(params.limit));
      const response = await axiosInstance.get<PeopleListResource>(
        `/projects/${slug}/people?${search.toString()}`,
      );
      return response.data;
    },
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });
}

export function usePersonQuery(slug: string | undefined, personId: string | undefined) {
  return useQuery<PersonDetailResource>({
    queryKey: ["person", slug, personId],
    queryFn: async () => {
      const response = await axiosInstance.get<PersonDetailResource>(
        `/projects/${slug}/people/${personId}`,
      );
      return response.data;
    },
    enabled: Boolean(slug && personId),
    refetchOnWindowFocus: false,
  });
}

export function usePersonActivityQuery(slug: string | undefined, personId: string | undefined) {
  return useQuery<Array<{ id: string; name: string; properties: Record<string, unknown> | null; occurredAt: number; sessionId: string | null }>>({
    queryKey: ["person-activity", slug, personId],
    queryFn: async () => {
      const response = await axiosInstance.get(
        `/projects/${slug}/people/${personId}/activity`,
      );
      return response.data;
    },
    enabled: Boolean(slug && personId),
    refetchOnWindowFocus: false,
  });
}

export function useTotalsQuery(slug: string | undefined) {
  return useQuery<TotalsResource>({
    queryKey: ["totals", slug],
    queryFn: async () => {
      const response = await axiosInstance.get<TotalsResource>(`/projects/${slug}/totals`);
      return response.data;
    },
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });
}

export function useBreakdownQuery(
  slug: string | undefined,
  dimension: "event" | "person" | "session" | "context-kind" | "context-platform",
) {
  return useQuery<BreakdownResource>({
    queryKey: ["breakdown", slug, dimension],
    queryFn: async () => {
      const response = await axiosInstance.get<BreakdownResource>(
        `/projects/${slug}/breakdown?dimension=${dimension}`,
      );
      return response.data;
    },
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });
}

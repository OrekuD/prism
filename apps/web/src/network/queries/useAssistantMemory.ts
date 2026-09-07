/**
 * Assistant memory client (Task 21 slice 7): confirmed definitions and
 * inline proposal confirmation. Shared definitions need owner/admin
 * confirmation; member preferences apply immediately (no confirm step).
 */
import { useCallback } from "react";
import type { MemoryRecord } from "@prism-analytics/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";

export function assistantMemoryKey(slug: string) {
  return ["assistant-memory", slug] as const;
}

export function useAssistantMemoryQuery(slug: string | undefined) {
  return useQuery({
    queryKey: assistantMemoryKey(slug ?? ""),
    queryFn: async (): Promise<{ records: MemoryRecord[] }> => {
      const response = await axiosInstance.get(
        `/projects/${slug}/assistant/memory`,
      );
      return response.data;
    },
    enabled: Boolean(slug),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useDecideAssistantProposal(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(
    async (
      proposalId: string,
      action: "confirm" | "reject",
    ): Promise<{ ok: boolean; status?: number }> => {
      if (!slug) return { ok: false };
      try {
        await axiosInstance.post(
          `/projects/${slug}/assistant/memory/${proposalId}/${action}`,
        );
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response
          ?.status;
        return { ok: false, status };
      }
      await queryClient.invalidateQueries({
        queryKey: assistantMemoryKey(slug),
      });
      return { ok: true };
    },
    [slug, queryClient],
  );
}

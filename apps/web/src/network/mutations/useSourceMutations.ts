import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { ErrorResource, OkResource } from "@prism-analytics/types";
import type { AxiosError } from "axios";
import type {
  SourceKeyResource,
  SourceResource,
} from "@/network/queries/useSourcesQuery";

/**
 * Cache-first mutations: when the server returns the created/updated
 * resource it is written straight into the source list/detail queries, so
 * the UI reflects the change immediately. Invalidations still run in the
 * background to keep server truth.
 */

export function useCreateSourceMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      platform: string;
      allowedOrigins?: string[];
    }) => {
      const response = await axiosInstance.post<SourceResource>(
        `/projects/${slug}/sources`,
        payload,
      );
      return response.data;
    },
    onSuccess: (created: SourceResource) => {
      toast.success("Source created");
      // The response IS the new source — append it to the list now.
      queryClient.setQueryData<SourceResource[]>(["sources", slug], (current) =>
        current ? [...current, created] : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: (error: AxiosError<ErrorResource>) => {
      const code = error.response?.data.errors?.[0];
      if (code === "cannot_create_source") {
        toast.error("You don't have permission to create sources here.");
      } else if (code === "allowed_origins_web_only") {
        toast.error("Allowed origins are only valid for web sources.");
      } else {
        toast.error("Something went wrong");
      }
    },
  });
}

export function useUpdateSourceMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      sourceId: string;
      name?: string;
      allowedOrigins?: string[];
    }) => {
      const { sourceId, ...body } = payload;
      const response = await axiosInstance.patch<SourceResource>(
        `/projects/${slug}/sources/${sourceId}`,
        body,
      );
      return response.data;
    },
    onSuccess: (updated: SourceResource, payload) => {
      toast.success("Source updated");
      // The response is the updated source — swap it into both caches.
      queryClient.setQueryData<SourceResource[]>(["sources", slug], (list) =>
        list?.map((source) =>
          source.id === payload.sourceId ? updated : source,
        ),
      );
      queryClient.setQueryData<SourceResource>(
        ["source", slug, payload.sourceId],
        updated,
      );
      void queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

export function useDeleteSourceMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string) => {
      const response = await axiosInstance.delete<OkResource>(
        `/projects/${slug}/sources/${sourceId}`,
      );
      return response.data;
    },
    onSuccess: (_data, sourceId) => {
      toast.success("Source deleted");
      // Drop it from the list and detail caches immediately.
      queryClient.setQueryData<SourceResource[]>(["sources", slug], (list) =>
        list?.filter((source) => source.id !== sourceId),
      );
      queryClient.removeQueries({ queryKey: ["source", slug, sourceId] });
      void queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

export function useCreateKeyMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { sourceId: string; name: string }) => {
      const response = await axiosInstance.post<SourceKeyResource>(
        `/projects/${slug}/sources/${payload.sourceId}/keys`,
        { name: payload.name },
      );
      return response.data;
    },
    onSuccess: (created: SourceKeyResource, payload) => {
      toast.success("Key created");
      const newKey: SourceKeyResource = {
        id: created.id,
        name: created.name,
        keyType: created.keyType,
        status: created.status ?? "active",
        createdAt: created.createdAt ?? new Date().toISOString(),
        lastUsedAt: created.lastUsedAt ?? null,
        value: created.value,
      };
      queryClient.setQueryData<SourceResource[]>(["sources", slug], (list) =>
        list?.map((source) =>
          source.id === payload.sourceId
            ? { ...source, keys: [...source.keys, newKey] }
            : source,
        ),
      );
      queryClient.setQueryData<SourceResource>(
        ["source", slug, payload.sourceId],
        (source) => (source ? { ...source, keys: [...source.keys, newKey] } : source),
      );
      void queryClient.invalidateQueries({ queryKey: ["sources", slug] });
      void queryClient.invalidateQueries({ queryKey: ["source", slug, payload.sourceId] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

export function useRevokeKeyMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { sourceId: string; keyId: string }) => {
      const response = await axiosInstance.post<OkResource>(
        `/projects/${slug}/sources/${payload.sourceId}/keys/${payload.keyId}/revoke`,
      );
      return response.data;
    },
    onSuccess: (_data, payload) => {
      toast.success("Key revoked");
      // Mark the key revoked in both caches right away.
      const revokeInSource = (source: SourceResource): SourceResource => ({
        ...source,
        keys: source.keys.map((key) =>
          key.id === payload.keyId ? { ...key, status: "revoked" as const } : key,
        ),
      });
      queryClient.setQueryData<SourceResource>(
        ["source", slug, payload.sourceId],
        (source) => (source ? revokeInSource(source) : source),
      );
      queryClient.setQueryData<SourceResource[]>(["sources", slug], (list) =>
        list?.map((source) =>
          source.id === payload.sourceId ? revokeInSource(source) : source,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

export function useRevealKeyMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { sourceId: string; keyId: string }) => {
      const response = await axiosInstance.post<{ value: string }>(
        `/projects/${slug}/sources/${payload.sourceId}/keys/${payload.keyId}/reveal`,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { ErrorResource, OkResource } from "@prism-analytics/types";
import type { AxiosError } from "axios";
import type { SourceResource } from "@/network/queries/useSourcesQuery";

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
    onSuccess: () => {
      toast.success("Source created");
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
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
    onSuccess: () => {
      toast.success("Source updated");
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
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
    onSuccess: () => {
      toast.success("Source deleted");
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
    },
    onError: () => toast.error("Something went wrong"),
  });
}

export function useCreateKeyMutation(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { sourceId: string; name: string }) => {
      const response = await axiosInstance.post<{
        name: string;
        keyType: "publishable" | "secret";
        value: string;
      }>(`/projects/${slug}/sources/${payload.sourceId}/keys`, payload);
      return response.data;
    },
    onSuccess: () => {
      toast.success("Key created");
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
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
    onSuccess: () => {
      toast.success("Key revoked");
      queryClient.invalidateQueries({ queryKey: ["sources", slug] });
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

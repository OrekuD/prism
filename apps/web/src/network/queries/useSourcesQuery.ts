import { axiosInstance } from "@/utils/axiosInstance";
import { useQuery } from "@tanstack/react-query";

/**
 * Task 13 source resources (project → sources → ingestion keys). Key
 * values: publishable keys are returned in full (they are public by
 * design and embedded in client binaries); secret keys are masked unless
 * revealed through the admin-only reveal endpoint.
 */
export type SourceKeyResource = {
  id: string;
  name: string;
  keyType: "publishable" | "secret";
  status: "active" | "revoked";
  lastUsedAt: string | null;
  createdAt: string;
  value: string;
};

export type SourceResource = {
  id: string;
  projectId: string;
  name: string;
  platform: "web" | "ios" | "android" | "react-native" | "server";
  allowedOrigins: string[];
  keys: SourceKeyResource[];
  telemetry: { events: number; lastReceivedAt: number | null };
  initialKey?: string;
};

export async function fetchSources(slug: string): Promise<SourceResource[]> {
  const response = await axiosInstance.get<SourceResource[]>(
    `/projects/${slug}/sources`,
  );
  return response.data;
}

export function useSourcesQuery(slug: string | undefined) {
  return useQuery<SourceResource[]>({
    queryKey: ["sources", slug],
    queryFn: () => fetchSources(slug ?? ""),
    enabled: Boolean(slug),
    refetchOnWindowFocus: false,
  });
}

export async function fetchSource(
  slug: string,
  sourceId: string,
): Promise<SourceResource> {
  const response = await axiosInstance.get<SourceResource>(
    `/projects/${slug}/sources/${sourceId}`,
  );
  return response.data;
}

export function useSourceQuery(slug: string | undefined, sourceId: string | undefined) {
  return useQuery<SourceResource>({
    queryKey: ["source", slug, sourceId],
    queryFn: () => fetchSource(slug ?? "", sourceId ?? ""),
    enabled: Boolean(slug && sourceId),
    refetchOnWindowFocus: false,
  });
}

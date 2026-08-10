import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { axiosInstance } from "@/utils/axiosInstance";
import type { EventResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function projectEvents(slug: string | undefined) {
  const response = await axiosInstance.get(`/projects/${slug}/events`);

  if (response.status === 200) {
    return response.data as Array<EventResource>;
  }
  return [];
}

export function useProjectEventsQuery(slug: string | undefined) {
  return useQuery<Array<EventResource>>({
    queryKey: ["project-events", slug],
    queryFn: () => projectEvents(slug),
    enabled:
      Boolean(localStorage.getItem(LocalStorageKeys.TOKEN)) && Boolean(slug),
    refetchOnWindowFocus: false,
  });
}

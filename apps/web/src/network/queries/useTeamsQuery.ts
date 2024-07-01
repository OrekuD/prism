import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { axiosInstance } from "@/utils/axiosInstance";
import type { TeamResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function teams() {
  const accessToken = localStorage.getItem(LocalStorageKeys.TOKEN);

  const response = await axiosInstance.get("/teams", {
    headers: {
      Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
    },
  });

  if (response.status === 200) {
    return response.data;
  }
}
export function useTeamsQuery() {
  return useQuery<Array<TeamResource>>({
    queryKey: ["teams"],
    queryFn: teams,
    enabled: Boolean(localStorage.getItem(LocalStorageKeys.TOKEN) || ""),
  });
}

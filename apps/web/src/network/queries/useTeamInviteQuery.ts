import { axiosInstance } from "@/utils/axiosInstance";
import type { TeamInviteResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";

async function teamInvite(token: string) {
  const response = await axiosInstance.get(`/teams/invite/${token}`);

  if (response.status === 200) {
    return response.data;
  }
}

export function useTeamInviteQuery() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  return useQuery<TeamInviteResource>({
    queryKey: ["team-invite"],
    queryFn: () => teamInvite(token!),
    enabled: Boolean(token || ""),
  });
}

import { axiosInstance } from "@/utils/axiosInstance";
import type { TeamInviteLinkResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function teamInviteLink(teamId: string) {
  const response = await axiosInstance.get(`/teams/${teamId}/invite-link`);

  if (response.status === 200) {
    return response.data;
  }
}

export function useTeamInviteLinkQuery(teamId: string) {
  return useQuery<TeamInviteLinkResource>({
    queryKey: ["team-invite-link", teamId],
    queryFn: () => teamInviteLink(teamId),
    enabled: Boolean(teamId),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

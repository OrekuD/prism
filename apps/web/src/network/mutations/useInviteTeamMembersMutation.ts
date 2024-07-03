import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  ErrorResource,
  OkResource,
  SendTeamInvitesRequest,
} from "@prism/types";
import { AxiosError } from "axios";

async function inviteTeamMembers({
  teamId,
  ...payload
}: SendTeamInvitesRequest) {
  const url = `/teams/${teamId}/send-invites`;

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useInviteTeamMembersMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: inviteTeamMembers,
    onSuccess: (data: OkResource) => {
      toast("Invites sent");
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "max_number_teams_exceeded":
            toast("You need to upgrade to the Pro plan");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { DeleteTeamRequest, OkResource, TeamResource } from "@prism/types";
import { AxiosResponse } from "axios";

async function deleteTeam(payload: DeleteTeamRequest) {
  const url = `/teams/${payload.teamId}`;

  const response = await axiosInstance.delete<any, AxiosResponse<OkResource>>(
    url,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useDeleteTeamMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTeam,
    onSuccess: (_, { teamId }) => {
      toast("Team deleted successfully");
      const teams: Array<TeamResource> | undefined = queryClient.getQueryData([
        "teams",
      ]);
      if (teams) {
        queryClient.setQueryData(
          ["teams"],
          teams.filter(({ id }) => id !== teamId),
        );
      }
    },
    onError: (error) => {
      toast("Something went wrong");
    },
  });
}

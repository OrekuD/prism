import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  ErrorResource,
  OkResource,
  RenameProjectRequest,
} from "@prism/types";
import type { AxiosError } from "axios";

async function renameProject(payload: RenameProjectRequest & { projectId: string }) {
  const { projectId, ...body } = payload;
  const response = await axiosInstance.patch<OkResource>(
    `/projects/${projectId}`,
    body,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useRenameProjectMutation(slug: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameProject,
    onSuccess: () => {
      toast("Project renamed");
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: AxiosError<ErrorResource>) => {
      toast(
        error.response?.data.errors?.[0] === "cannot_rename_project"
          ? "You don't have permission to rename this project"
          : "Something went wrong",
      );
    },
  });
}

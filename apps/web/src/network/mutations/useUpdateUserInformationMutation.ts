import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import {
  ErrorResource,
  ProfileResource,
  UpdateUserInformationRequest,
} from "@prism/types";
import { AxiosError } from "axios";

async function updateUserInformation(payload: UpdateUserInformationRequest) {
  const url = `/user`;

  const response = await axiosInstance.put(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useUpdateUserInformationMutation() {
  const userStore = useUserStore();

  return useMutation({
    mutationFn: updateUserInformation,
    onSuccess: (data: ProfileResource) => {
      userStore.updateProfile(data);
    },
    onError: (error: AxiosError<ErrorResource>) => {
      toast("Something went wrong");
    },
  });
}

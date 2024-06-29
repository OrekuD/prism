import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import type {
  ErrorResource,
  UpdateUsernameRequest,
  UpdateUsernameResource,
} from "@prism/types";
import { AxiosError } from "axios";

async function updateUsername(payload: UpdateUsernameRequest) {
  const url = "/user/update-username";

  const response = await axiosInstance.put(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useUpdateUsernameMutation() {
  const userStore = useUserStore();

  return useMutation({
    mutationFn: updateUsername,
    onSuccess: (data: UpdateUsernameResource) => {
      // userStore.setUser(data);
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "username_taken":
            toast("Username is taken");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}

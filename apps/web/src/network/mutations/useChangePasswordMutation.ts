import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  ChangePasswordRequest,
  ErrorResource,
  OkResource,
} from "@prism/types";
import type { AxiosError } from "axios";

async function changePassword(payload: ChangePasswordRequest) {
  const response = await axiosInstance.put<OkResource>(
    "/user/change-password",
    payload,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast("Password updated");
    },
    onError: (error: AxiosError<ErrorResource>) => {
      const message = error.response?.data.errors?.[0];
      if (message === "old_password_incorrect") {
        toast("Current password is incorrect");
      } else {
        toast("Something went wrong");
      }
    },
  });
}

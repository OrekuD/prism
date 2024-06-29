import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { ErrorResource } from "@prism/types";
import { AxiosError } from "axios";

async function sendVerifyEmail() {
  const url = "/user/send-verify-email";

  const response = await axiosInstance.post(url);

  if (response.status === 200) {
    return response.data;
  }
}

export function useSendVerifyEmailMutation() {
  return useMutation({
    mutationFn: sendVerifyEmail,
    onSuccess: () => {
      toast("Verification email sent");
    },
    onError: (error: AxiosError<ErrorResource>) => {
      toast("Something went wrong");
    },
  });
}

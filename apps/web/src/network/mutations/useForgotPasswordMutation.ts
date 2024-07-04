import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { ForgotPasswordRequest } from "@prism/types";

async function forgotPassword(payload: ForgotPasswordRequest) {
  const url = "/auth/forgot-password";

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: forgotPassword,
    onSuccess: (data) => {
      toast("Please check you email");
    },
    onError: () => {
      toast("Invalid Credentials");
    },
  });
}

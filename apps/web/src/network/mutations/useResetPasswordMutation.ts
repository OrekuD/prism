import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { ResetPasswordRequest } from "@prism/types";
import { useNavigate } from "react-router-dom";

async function resetPassword(payload: ResetPasswordRequest) {
  const url = "/auth/reset-password";

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useResetPasswordMutation() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      toast("Password updated successfully");
      navigate("/auth/log-in");
    },
    onError: () => {
      toast("Something went wrong");
    },
  });
}

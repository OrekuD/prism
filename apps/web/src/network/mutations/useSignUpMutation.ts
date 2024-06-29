import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { toast } from "sonner";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";
import { AuthResource } from "../resources/AuthResource";
import { ErrorResource, SignUpRequest } from "@prism/types";
import { AxiosError } from "axios";

async function signUp(payload: SignUpRequest) {
  const url = `/auth/sign-up`;

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useSignUpMutation() {
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signUp,
    onSuccess: ({ user, ...data }: AuthResource) => {
      localStorage.setItem(LocalStorageKeys.TOKEN, data.accessToken);
      userStore.setUser(user);
      authenticationStore.setAuthentication(data);
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "email_taken":
            toast("Email is taken");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}

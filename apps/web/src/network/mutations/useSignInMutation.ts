import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { toast } from "sonner";
import { AuthResource } from "../resources/AuthResource";
import { useUserStore } from "@/store/userStore";
import { useAuthenticationStore } from "@/store/authenticationStore";
import {} from "@prism/types";

async function signIn(payload: SignInRequest) {
  const url = `/auth/sign-in`;

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
  const error = response.data?.errors?.[0] || "Something went wrong.";

  return Promise.reject(error);
}

export function useSignInMutation() {
  const queryClient = useQueryClient();
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: ({ user, ...data }: AuthResource) => {
      localStorage.setItem(LocalStorageKeys.AUTHENTICATION, data.accessToken);
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      userStore.setUser(user);
      authenticationStore.setAuthentication(data);
    },
    onError: () => {
      toast("Invalid Credentials");
    },
  });

  return mutation;
}

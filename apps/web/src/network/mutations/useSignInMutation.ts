import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import { useAuthenticationStore } from "@/store/authenticationStore";
import type { AuthResource, SignInRequest } from "@prism/types";

async function signIn(payload: SignInRequest) {
  const url = "/auth/sign-in";

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useSignInMutation() {
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signIn,
    onSuccess: ({ user, ...data }: AuthResource) => {
      localStorage.setItem(LocalStorageKeys.TOKEN, data.accessToken);
      userStore.setUser(user);
      authenticationStore.setAuthentication(data);
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      window.location.reload();
    },
    onError: (error) => {
      console.log({ error });
      toast("Invalid Credentials");
    },
  });
}

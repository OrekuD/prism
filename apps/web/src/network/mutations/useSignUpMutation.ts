import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { toast } from "sonner";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";
import { AuthResource } from "../resources/AuthResource";

interface SignUpRequest {
  email: string;
  firstname: string;
  lastname: string;
  password: string;
}

async function signUp(payload: SignUpRequest) {
  const url = `/auth/sign-up`;

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
  const error = response.data?.errors?.[0] || "Something went wrong.";

  return Promise.reject(error);
}

export function useSignUpMutation() {
  const queryClient = useQueryClient();
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  const mutation = useMutation({
    mutationFn: signUp,
    onSuccess: ({ user, ...data }: AuthResource) => {
      localStorage.setItem(LocalStorageKeys.AUTHENTICATION, data.accessToken);
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
      userStore.setUser(user);
      authenticationStore.setAuthentication(data);
    },
    onError: (error) => {
      console.log({ error });
      toast("Something went wrong");
    },
  });

  return mutation;
}

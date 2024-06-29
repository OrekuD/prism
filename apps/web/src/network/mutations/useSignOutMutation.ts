import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { LocalStorageKeys } from "@/constants/LocalStorageKeys";

async function signOut() {
  const url = `/auth/sign-out`;

  const response = await axiosInstance.post(url);

  if (response.status === 200) {
    return response.data;
  }
}

export function useSignOutMutation() {
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      localStorage.removeItem(LocalStorageKeys.TOKEN);
      userStore.setUser(null);
      authenticationStore.setAuthentication(null);
    },
    onError: (error) => {
      console.log({ error });
      toast("Something went wrong");
    },
  });
}

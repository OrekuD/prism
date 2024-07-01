import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { clearLocalStorage } from "@/utils/clearLocalStorage";

async function signOutFromAllSessions() {
  const url = "/auth/sign-out-from-all-sessions";

  const response = await axiosInstance.post(url);

  if (response.status === 200) {
    return response.data;
  }
}

export function useSignOutFromAllSessionsMutation() {
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  return useMutation({
    mutationFn: signOutFromAllSessions,
    onSuccess: () => {
      clearLocalStorage();
      userStore.setUser(null);
      authenticationStore.setAuthentication(null);
    },
    onError: (error) => {
      console.log({ error });
      toast("Something went wrong");
    },
  });
}

import React from "react";
import { useCurrentUserQuery } from "@/network/queries/useCurrentUserQuery";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";

export function useRefreshUser() {
  const { isError, data } = useCurrentUserQuery();
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  React.useEffect(() => {
    if (!navigator.onLine) return;
    if (isError) {
      authenticationStore.setAuthentication(null);
    }
  }, [isError, authenticationStore.setAuthentication]);

  React.useEffect(() => {
    if (!data) return;
    userStore.setUser(data);
  }, [data, userStore.setUser]);
}

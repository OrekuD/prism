import { useCurrentUserQuery } from "@/network/queries/useCurrentUserQuery";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";
import React from "react";

export function useRefreshUser() {
  const { isError, data, error } = useCurrentUserQuery();
  const authenticationStore = useAuthenticationStore();
  const userStore = useUserStore();

  React.useEffect(() => {
    if (!navigator.onLine) return;
    if (isError) {
      authenticationStore.setAuthentication(null);
    }
  }, [isError]);

  // React.useEffect(() => {
  //   if (!data) return;
  //   userStore.setUser(data);
  // }, [data]);
}

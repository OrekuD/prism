import React from "react";
import { useCurrentUserQuery } from "@/network/queries/useCurrentUserQuery";
import { useUserStore } from "@/store/userStore";

/**
 * Loads the Prism user resource (profile data) into the user store once a
 * Better Auth session exists. The session itself is owned by Better Auth.
 */
export function useRefreshUser(hasSession: boolean) {
  const { isError, data } = useCurrentUserQuery(hasSession);
  const userStore = useUserStore();

  React.useEffect(() => {
    if (!data) return;
    userStore.setUser(data);
  }, [data, userStore.setUser]);

  React.useEffect(() => {
    if (isError) {
      userStore.setUser(null);
    }
  }, [isError, userStore.setUser]);
}

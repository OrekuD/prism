import { AuthResource } from "@/network/resources/AuthResource";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthenticationStore = {
  authentication: Omit<AuthResource, "user"> | null;
  isAuthenticated: boolean;
  setAuthentication: (value: Omit<AuthResource, "user"> | null) => void;
};

export const useAuthenticationStore = create<AuthenticationStore>()(
  persist(
    (set) => ({
      authentication: null,
      isAuthenticated: false,
      setAuthentication: (value) => {
        set({
          authentication: value,
          isAuthenticated: Boolean(value),
        });
      },
    }),
    {
      name: "authentication-store",
    },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthenticationStore = {
  isAuthenticated: boolean;
  setIsAuthenticated: (value: boolean) => void;
};

const useAuthenticationStore = create<AuthenticationStore>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      setIsAuthenticated: (value) => {
        set({
          isAuthenticated: value,
        });
      },
    }),
    {
      name: "authentication-store",
    },
  ),
);

export default useAuthenticationStore;

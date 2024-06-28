import { User } from "@prism/types";
import { AuthResource } from "@/network/resources/AuthResource";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UserStore = {
  user: User | null;
  setUser: (value: User | null) => void;
};

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      setUser: (value) => {
        set({
          user: value,
        });
      },
    }),
    {
      name: "user-store",
    },
  ),
);

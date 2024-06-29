import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import {
  ChangeEmailResource,
  ProfileResource,
  UserResource,
} from "@prism/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UserStore = {
  user: UserResource | null;
  setUser: (value: UserResource | null) => void;
  updateProfile: (value: ProfileResource) => void;
  changeEmail: (value: ChangeEmailResource) => void;
};

export const useUserStore = create<UserStore>()(
  persist(
    (set, state) => ({
      user: null,
      setUser: (value) => {
        set({
          user: value,
        });
      },
      updateProfile: (value) => {
        const user = state().user;
        if (!user) return;

        set({
          user: { ...user, profile: value },
        });
      },
      changeEmail: (value) => {
        const user = state().user;
        if (!user) return;

        set({
          user: { ...user, email: value.email },
        });
      },
    }),
    {
      name: LocalStorageKeys.USER_STORE,
      // partialize: (state) => ({ user: state.user }),
    },
  ),
);

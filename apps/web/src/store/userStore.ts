import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import type {
  ProfilePictureResource,
  ProfileResource,
  UserResource,
} from "@prism/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UserStore = {
  user: UserResource | null;
  setUser: (value: UserResource | null) => void;
  updateProfile: (value: ProfileResource) => void;
  updateProfilePicture: (value: ProfilePictureResource) => void;
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
      updateProfilePicture: (value) => {
        const user = state().user;
        if (!user || !user.profile) return;

        set({
          user: {
            ...user,
            profile: {
              ...user.profile,
              profilePictureUrl: value.profilePictureUrl,
            },
          },
        });
      },
    }),
    {
      name: LocalStorageKeys.USER_STORE,
      // partialize: (state) => ({ user: state.user }),
    },
  ),
);

import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import type {
  ChangeEmailResource,
  ProfilePictureResource,
  ProfileResource,
  UpdateUsernameResource,
  UserResource,
} from "@prism/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UserStore = {
  user: UserResource | null;
  setUser: (value: UserResource | null) => void;
  updateProfile: (value: ProfileResource) => void;
  changeEmail: (value: ChangeEmailResource) => void;
  updateUsername: (value: UpdateUsernameResource) => void;
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
      changeEmail: (value) => {
        const user = state().user;
        if (!user) return;

        set({
          user: { ...user, email: value.email },
        });
      },
      updateUsername: (value) => {
        const user = state().user;
        if (!user) return;

        set({
          user: { ...user, userName: value.username },
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

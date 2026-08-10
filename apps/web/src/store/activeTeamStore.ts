import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ActiveTeamStore = {
  teamId: string | null;
  setTeamId: (value: string | null) => void;
};

export const useActiveTeamStore = create<ActiveTeamStore>()(
  persist(
    (set) => ({
      teamId: null,
      setTeamId: (value) => {
        set({
          teamId: value,
        });
      },
    }),
    {
      name: LocalStorageKeys.ACTIVE_TEAM_STORE,
    },
  ),
);

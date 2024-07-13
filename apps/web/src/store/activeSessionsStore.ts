import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import type { AuthResource, SessionResource } from "@prism/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ActiveSessionsStore = {
  sessions: Array<SessionResource>;
  addSession: (session: SessionResource) => void;
};

export const useActiveSessionsStore = create<ActiveSessionsStore>((set) => ({
  sessions: [],
  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
    })),
}));

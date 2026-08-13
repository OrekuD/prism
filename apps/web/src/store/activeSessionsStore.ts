import type { SessionResource } from "@prism/types";
import { create } from "zustand";

/**
 * Project-scoped live sessions (release review): sessions are keyed by
 * projectId, deduplicated by sessionId, and cleared per project — a
 * user navigating between projects never sees the previous project's
 * sessions. Live data is intentionally NOT persisted (no stale
 * rehydration).
 */
type ActiveSessionsStore = {
  sessionsByProject: Record<string, Array<SessionResource>>;
  addSession: (projectId: string, session: SessionResource) => void;
  clearProject: (projectId: string) => void;
};

export const useActiveSessionsStore = create<ActiveSessionsStore>((set) => ({
  sessionsByProject: {},
  addSession: (projectId, session) =>
    set((state) => {
      const current = state.sessionsByProject[projectId] ?? [];
      if (current.some((existing) => existing.sessionId === session.sessionId)) {
        return state; // dedup: the same session is never listed twice
      }
      return {
        sessionsByProject: {
          ...state.sessionsByProject,
          [projectId]: [...current, session],
        },
      };
    }),
  clearProject: (projectId) =>
    set((state) => {
      const next = { ...state.sessionsByProject };
      delete next[projectId];
      return { sessionsByProject: next };
    }),
}));

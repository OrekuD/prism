import { beforeEach, describe, expect, it } from "vitest";
import { useActiveSessionsStore } from "@/store/activeSessionsStore";
import type { SessionResource } from "@prism-analytics/types";

/**
 * Project-scoped live sessions (release review): sessions never leak
 * across projects, never duplicate, and clear with the project.
 */
function session(id: string, overrides: Partial<SessionResource> = {}): SessionResource {
  return {
    sessionId: id,
    projectId: "p1",
    anonymousId: null,
    startedAt: 1,
    endedAt: null,
    lastSeenAt: 2,
    context: null,
    isOnline: 1,
    ...overrides,
  };
}

describe("activeSessionsStore", () => {
  beforeEach(() => {
    useActiveSessionsStore.setState({ sessionsByProject: {} });
  });

  it("scopes sessions per project", () => {
    useActiveSessionsStore.getState().addSession("p1", session("s1"));
    useActiveSessionsStore.getState().addSession("p2", session("s2"));
    const { sessionsByProject } = useActiveSessionsStore.getState();
    expect(sessionsByProject.p1?.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(sessionsByProject.p2?.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("deduplicates by sessionId", () => {
    const store = useActiveSessionsStore.getState();
    store.addSession("p1", session("s1"));
    store.addSession("p1", session("s1"));
    expect(useActiveSessionsStore.getState().sessionsByProject.p1).toHaveLength(1);
  });

  it("clears a project without touching others", () => {
    const store = useActiveSessionsStore.getState();
    store.addSession("p1", session("s1"));
    store.addSession("p2", session("s2"));
    store.clearProject("p1");
    const { sessionsByProject } = useActiveSessionsStore.getState();
    expect(sessionsByProject.p1).toBeUndefined();
    expect(sessionsByProject.p2).toHaveLength(1);
  });
});

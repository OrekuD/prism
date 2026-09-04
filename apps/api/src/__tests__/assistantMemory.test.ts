/**
 * Slice 4 typed-memory storage tests (Task 21 slice 4).
 *
 * REAL ephemeral PostgreSQL (see `assistantDb.ts`): proposal lifecycle,
 * confirmation permission and races, supersession slots, audit history,
 * cross-tenant isolation, retention, and workspace/user purge paths.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  hasLocalPostgres,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from "./assistantDb";
import {
  confirmMemoryProposal,
  createConversationWithFirstMessage,
  listMemory,
  proposeMemory,
  purgeAssistantRetention,
  purgeAssistantUserData,
  purgeAssistantWorkspaceData,
  readConfirmedKnowledge,
  readMemoryAudit,
  type AssistantDb,
} from "../utils/assistantStore";

const run = hasLocalPostgres() ? describe : describe.skip;

let pg: EphemeralPostgres | null = null;
let db: AssistantDb;

beforeAll(async () => {
  if (!hasLocalPostgres()) return;
  pg = await startEphemeralPostgres("assistant_mem_test");
  db = pg.sql as unknown as AssistantDb;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

const NOW = 1_785_628_800_000;
let seq = 1000;
const tick = (): number => {
  seq += 1;
  return NOW + seq * 1000;
};

type Tenant = {
  userId: string;
  orgId: string;
  projectId: string;
};

async function newTenant(tag: string): Promise<Tenant> {
  seq += 1;
  const userId = `u_${tag}_${seq}`;
  const orgId = `org_${tag}_${seq}`;
  await db`INSERT INTO "user" (id, name, email, email_verified)
    VALUES (${userId}, ${tag}, ${`${userId}@example.com`}, true)`;
  await db`INSERT INTO organization (id, name, slug, created_at)
    VALUES (${orgId}, ${tag}, ${`${orgId}-slug`}, ${new Date(NOW).toISOString()})`;
  await db`INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`m_${tag}_${seq}`}, ${orgId}, ${userId}, 'member', ${new Date(NOW).toISOString()})`;
  const rows = await db`INSERT INTO projects (creator_id, organization_id, name, slug)
    VALUES (${userId}, ${orgId}, ${tag}, ${`proj-${tag}-${seq}`}) RETURNING id`;
  return { userId, orgId, projectId: String(rows[0]?.id) };
}

function definitionValue(label = "Signup") {
  return {
    version: 1,
    label,
    description: `${label} definition`,
    payload: { kind: "standard-event", eventKey: "sign_up" },
  };
}

run("proposal lifecycle", () => {
  it("proposes, hides from knowledge, confirms, and audits", async () => {
    const tenant = await newTenant("life");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(proposal.status).toBe("proposed");
    expect(proposal.proposerId).toBe(tenant.userId);
    expect(proposal.confirmerId).toBeNull();
    // Proposals never leak into confirmed knowledge.
    const before = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(before.project).toHaveLength(0);
    const confirmed = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: proposal.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error("expected confirm");
    expect(confirmed.record.status).toBe("confirmed");
    expect(confirmed.record.confirmerId).toBe(tenant.userId);
    expect(confirmed.supersededIds).toHaveLength(0);
    const after = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(after.project.map((entry) => entry.id)).toContain(proposal.id);
    const audit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: proposal.id,
    });
    expect(audit?.map((entry) => entry.action)).toEqual([
      "proposed",
      "confirm",
    ]);
  });

  it("rejects and closes the proposal", async () => {
    const tenant = await newTenant("reject");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "activation-definition",
      projectId: tenant.projectId,
      value: definitionValue("Activation"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const rejected = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: proposal.id,
      confirmerId: tenant.userId,
      role: "admin",
      now: tick(),
      action: "reject",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error("expected reject");
    expect(rejected.record.status).toBe("rejected");
    const again = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: proposal.id,
      confirmerId: tenant.userId,
      role: "admin",
      now: tick(),
      action: "confirm",
    });
    expect(again).toEqual({ ok: false, reason: "not-proposed" });
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project).toHaveLength(0);
  });

  it("resolves concurrent confirmations to a single winner", async () => {
    const tenant = await newTenant("confrace");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "key-outcome-definition",
      projectId: tenant.projectId,
      value: definitionValue("Outcome"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const attempts = await Promise.all(
      [1, 2].map(() =>
        confirmMemoryProposal(db, {
          organizationId: tenant.orgId,
          recordId: proposal.id,
          confirmerId: tenant.userId,
          role: "owner",
          now: tick(),
          action: "confirm" as const,
        }),
      ),
    );
    expect(attempts.filter((entry) => entry.ok)).toHaveLength(1);
    expect(
      attempts.filter(
        (entry) => !entry.ok && entry.reason === "not-proposed",
      ),
    ).toHaveLength(1);
  });
});

run("confirmation permission", () => {
  it("members cannot confirm shared knowledge but own their preferences", async () => {
    const tenant = await newTenant("perm");
    const shared = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(
      await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: shared.id,
        confirmerId: tenant.userId,
        role: "member",
        now: tick(),
        action: "confirm",
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    const pref = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      subjectUserId: tenant.userId,
      value: {
        version: 1,
        label: "Range",
        description: "Preferred range",
        payload: { range: "30d" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    // Member preferences never need confirmation (frozen contract):
    // valid saves are immediately confirmed, never proposed.
    expect(pref.status).toBe("confirmed");
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.member.map((entry) => entry.id)).toContain(pref.id);
    const audit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: pref.id,
    });
    expect(audit?.map((entry) => entry.action)).toEqual(["confirmed"]);
  });

  it("missing and foreign proposals stay non-disclosing", async () => {
    const tenant = await newTenant("propnf");
    const stranger = await newTenant("propstranger");
    expect(
      await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: "mem_missing",
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(
      await confirmMemoryProposal(db, {
        organizationId: stranger.orgId,
        recordId: proposal.id,
        confirmerId: stranger.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(
      await readMemoryAudit(db, {
        organizationId: stranger.orgId,
        memoryId: proposal.id,
      }),
    ).toBeNull();
  });
});

run("supersession slots", () => {
  it("confirming a new definition supersedes the prior one", async () => {
    const tenant = await newTenant("supersede");
    const first = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue("Old"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(
      await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: first.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).toMatchObject({ ok: true });
    const second = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue("New"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const confirmed = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: second.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error("expected confirm");
    expect(confirmed.supersededIds).toEqual([first.id]);
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project.map((entry) => entry.id)).toEqual([second.id]);
    const audit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: first.id,
    });
    expect(audit?.map((entry) => entry.action)).toEqual([
      "proposed",
      "confirm",
      "superseded",
    ]);
  });

  it("distinct business terms coexist in one project", async () => {
    const tenant = await newTenant("terms");
    for (const name of ["Churn", "Expansion"]) {
      const proposal = await proposeMemory(db, {
        organizationId: tenant.orgId,
        scope: "project",
        key: "business-term",
        projectId: tenant.projectId,
        value: {
          version: 1,
          label: name,
          description: `${name} term`,
          payload: { name, description: `${name} term` },
        },
        proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
        now: tick(),
      });
      const confirmed = await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: proposal.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) throw new Error("expected confirm");
      expect(confirmed.supersededIds).toHaveLength(0);
    }
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project).toHaveLength(2);
  });
});

run("memory validation", () => {
  it("rejects invalid key/scope combinations and oversized payloads", async () => {
    const tenant = await newTenant("memvalid");
    const base = {
      organizationId: tenant.orgId,
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    };
    // Workspace-only key on a project scope.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "project",
        key: "preferred-comparison-range",
        projectId: tenant.projectId,
        value: {
          version: 1,
          label: "x",
          description: "x",
          payload: { range: "7d" },
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Project scope without a project.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "project",
        key: "signup-definition",
        value: definitionValue(),
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Workspace memory carrying a project.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "workspace",
        key: "business-term",
        projectId: tenant.projectId,
        value: {
          version: 1,
          label: "x",
          description: "x",
          payload: { name: "x", description: "x" },
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Member memory for someone else is rejected; an omitted subject
    // defaults to the authenticated member.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "member",
        key: "preferred-comparison-range",
        subjectUserId: "u_someone_else",
        value: {
          version: 1,
          label: "x",
          description: "x",
          payload: { range: "7d" },
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    const own = await proposeMemory(db, {
      ...base,
      scope: "member",
      key: "preferred-comparison-range",
      value: {
        version: 1,
        label: "x",
        description: "x",
        payload: { range: "7d" },
      },
    });
    expect(own.status).toBe("confirmed");
    expect(own.subjectUserId).toBe(tenant.userId);
    // Wrong payload shape for a definition key.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "project",
        key: "signup-definition",
        projectId: tenant.projectId,
        value: {
          version: 1,
          label: "x",
          description: "x",
          payload: { name: "x", description: "x" },
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Oversized label.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "project",
        key: "signup-definition",
        projectId: tenant.projectId,
        value: { ...definitionValue(), label: "x".repeat(161) },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Missing proposer.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "project",
        key: "signup-definition",
        projectId: tenant.projectId,
        value: definitionValue(),
        proposerId: "",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("filters management reads without leaking tenants", async () => {
    const tenant = await newTenant("memlist");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(
      await listMemory(db, {
        organizationId: tenant.orgId,
        status: "proposed",
      }),
    ).toHaveLength(1);
    expect(
      await listMemory(db, {
        organizationId: tenant.orgId,
        status: "confirmed",
      }),
    ).toHaveLength(0);
    expect(
      await listMemory(db, {
        organizationId: "org_other",
        status: "proposed",
      }),
    ).toHaveLength(0);
    expect(
      await listMemory(db, {
        organizationId: tenant.orgId,
        projectId: tenant.projectId,
        scope: "workspace",
      }),
    ).toHaveLength(0);
    void proposal;
  });
});

run("memory isolation", () => {
  it("shares workspace knowledge but isolates projects and members", async () => {
    const tenant = await newTenant("isolation");
    const otherProject = await db`INSERT INTO projects (creator_id, organization_id, name, slug)
      VALUES (${tenant.userId}, ${tenant.orgId}, 'second', ${`second-${seq}`}) RETURNING id`;
    const otherId = String(otherProject[0]?.id);
    const stranger = await newTenant("isostranger");
    // Project definition on the first project.
    const definition = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: definition.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    // Shared workspace term.
    const term = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: {
        version: 1,
        label: "MRR",
        description: "Monthly recurring revenue",
        payload: { name: "MRR", description: "Monthly recurring revenue" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: term.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    // Member preference: immediately confirmed, no approval step.
    const pref = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      subjectUserId: tenant.userId,
      value: {
        version: 1,
        label: "Range",
        description: " Preferred range",
        payload: { range: "30d" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(pref.status).toBe("confirmed");
    // Same member, second project: workspace term is shared, the project
    // definition and the preference stay where they belong.
    const sibling = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: otherId,
      subjectUserId: tenant.userId,
    });
    expect(sibling.project).toHaveLength(0);
    expect(sibling.workspace.map((entry) => entry.id)).toEqual([term.id]);
    expect(sibling.member.map((entry) => entry.id)).toEqual([pref.id]);
    // Another workspace sees nothing.
    const foreign = await readConfirmedKnowledge(db, {
      organizationId: stranger.orgId,
      projectId: stranger.projectId,
      subjectUserId: stranger.userId,
    });
    expect(foreign).toEqual({ project: [], workspace: [], member: [] });
    // Cross-user preference isolation inside one workspace.
    const otherUser = await db`INSERT INTO "user" (id, name, email, email_verified)
      VALUES (${`u_colleague_${seq}`}, 'colleague', ${`colleague_${seq}@example.com`}, true) RETURNING id`;
    const colleagueId = String(otherUser[0]?.id);
    const colleague = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: colleagueId,
    });
    expect(colleague.member).toHaveLength(0);
    expect(colleague.workspace.map((entry) => entry.id)).toEqual([term.id]);
  });
});

run("memory retention and purge paths", () => {
  it("ages out audit history by window", async () => {
    const tenant = await newTenant("auditret");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: definitionValue(),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: NOW - 400 * 86_400_000,
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: proposal.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: NOW - 400 * 86_400_000 + 1000,
      action: "confirm",
    });
    const before = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: proposal.id,
    });
    expect(before).toHaveLength(2);
    const purged = await purgeAssistantRetention(db, NOW, {
      runRetentionDays: 90,
      auditRetentionDays: 365,
    });
    expect(purged.auditDeleted).toBeGreaterThanOrEqual(2);
    expect(
      await readMemoryAudit(db, {
        organizationId: tenant.orgId,
        memoryId: proposal.id,
      }),
    ).toHaveLength(0);
    // The record itself survives audit retention.
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project.map((entry) => entry.id)).toContain(proposal.id);
  });

  it("purges workspace and user data on their deletion paths", async () => {
    const tenant = await newTenant("wspurge");
    const chat = await db`SELECT 1 AS one`;
    void chat;
    const created = await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_wspurge_${seq}`,
      firstMessage: "workspace purge me",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    const term = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: {
        version: 1,
        label: "NDR",
        description: "Net dollar retention",
        payload: { name: "NDR", description: "Net dollar retention" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const purged = await purgeAssistantWorkspaceData(db, tenant.orgId);
    expect(purged.conversationsDeleted).toBe(1);
    expect(purged.memoriesDeleted).toBe(1);
    expect(
      await readMemoryAudit(db, {
        organizationId: tenant.orgId,
        memoryId: term.id,
      }),
    ).toBeNull();
    void created;
    // User path: chats and preferences go, shared records stay unattributed.
    const solo = await newTenant("userpurge");
    const mine = await proposeMemory(db, {
      organizationId: solo.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      subjectUserId: solo.userId,
      value: {
        version: 1,
        label: "Range",
        description: "r",
        payload: { range: "7d" },
      },
      proposerId: solo.userId,
      authenticatedUserId: solo.userId,
      now: tick(),
    });
    const shared = await proposeMemory(db, {
      organizationId: solo.orgId,
      scope: "project",
      key: "business-term",
      projectId: solo.projectId,
      value: {
        version: 1,
        label: "GPL",
        description: "x",
        payload: { name: "GPL", description: "x" },
      },
      proposerId: solo.userId,
      authenticatedUserId: solo.userId,
      now: tick(),
    });
    const userPurged = await purgeAssistantUserData(db, solo.userId);
    expect(userPurged.memoriesDeleted).toBe(1);
    const remaining = await listMemory(db, { organizationId: solo.orgId });
    expect(remaining.map((entry) => entry.id)).toEqual([shared.id]);
    expect(remaining[0]?.proposerId).toBe("deleted-user");
    void mine;
  });
});

run("same-slot confirmation race (R12-F2)", () => {
  it("serializes truly-overlapping confirms: exactly one wins", async () => {
    const tenant = await newTenant("slotrace");
    const value = (label: string) => ({
      version: 1,
      label,
      description: `${label} definition`,
      payload: { kind: "standard-event", eventKey: "sign_up" },
    });
    const seed = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: value("Seed"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: seed.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    const first = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: value("First"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const second = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: value("Second"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    // Force genuine statement overlap (timing-independent): pin a
    // connection, run the winner's succession inside an explicit
    // transaction WITHOUT committing (it now holds the slot's confirmed
    // row uncommitted), launch the loser's confirm (it blocks in its
    // slot-lock CTE holding no conflicting entry), wait until it is
    // observably blocked, then commit the winner. The loser unblocks,
    // re-reads the row as superseded, and fails at the deferred slot
    // invariant — rolling back entirely and reporting slot-conflict.
    // Lock order matches the store's slot-first discipline, so the
    // winner's commit never waits on the loser: no deadlock is possible.
    if (!pg) throw new Error("ephemeral postgres required");
    const pinned = await pg.sql.reserve();
    try {
      await pinned.unsafe("BEGIN");
      const pinnedDb = pinned as unknown as AssistantDb;
      const winner = await confirmMemoryProposal(pinnedDb, {
        organizationId: tenant.orgId,
        recordId: first.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      });
      expect(winner.ok).toBe(true);
      const loser = confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: second.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      });
      // Wait until the loser is observably blocked on the slot lock.
      const deadline = Date.now() + 5000;
      for (;;) {
        const waiting = (await db`
          SELECT COUNT(*) AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%assistant_memory%'`) as Array<{
          n: unknown;
        }>;
        if (Number(waiting[0]?.n) > 0) break;
        if (Date.now() > deadline) {
          throw new Error("loser never blocked on the slot");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await pinned.unsafe("COMMIT");
      const loserResult = await loser;
      expect(loserResult).toEqual({ ok: false, reason: "slot-conflict" });
    } finally {
      pinned.release();
    }
    // Exactly one value remains confirmed.
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project.map((entry) => entry.id)).toEqual([first.id]);
    // Every COMMITTED transition has audit history: the winner carries
    // proposed + confirm (+ the seed's supersede); the rolled-back loser
    // carries its proposal only.
    const winnerAudit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: first.id,
    });
    expect(winnerAudit?.map((entry) => entry.action)).toEqual([
      "proposed",
      "confirm",
    ]);
    const loserAudit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: second.id,
    });
    expect(loserAudit?.map((entry) => entry.action)).toEqual(["proposed"]);
    const seedAudit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: seed.id,
    });
    expect(seedAudit?.map((entry) => entry.action)).toEqual([
      "proposed",
      "confirm",
      "superseded",
    ]);
  });

  it("rolls back a failed confirm completely (R12-F2)", async () => {
    const tenant = await newTenant("confirmfault");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "signup-definition",
      projectId: tenant.projectId,
      value: {
        version: 1,
        label: "Signup",
        description: "Signup definition",
        payload: { kind: "standard-event", eventKey: "sign_up" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    let calls = 0;
    const faulty = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls += 1;
      // Call 1 is the pre-check read; call 2 is the atomic transition.
      if (calls === 2) throw new Error("injected fault");
      return db(strings, ...values);
    }) as never;
    await expect(
      confirmMemoryProposal(faulty, {
        organizationId: tenant.orgId,
        recordId: proposal.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).rejects.toThrow("injected fault");
    // Nothing committed: still proposed, no confirm audit, no supersede.
    const rows = await db`SELECT status FROM assistant_memory WHERE id = ${proposal.id}`;
    expect(String(rows[0]?.status)).toBe("proposed");
    const audit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: proposal.id,
    });
    expect(audit?.map((entry) => entry.action)).toEqual(["proposed"]);
  });
});

run("memory tenant binding (R12-F3)", () => {
  it("rejects organization/project mismatches without inserting", async () => {
    const orgA = await newTenant("memtena");
    const orgB = await newTenant("memtenb");
    await expect(
      proposeMemory(db, {
        organizationId: orgA.orgId,
        scope: "project",
        key: "signup-definition",
        projectId: orgB.projectId,
        value: {
          version: 1,
          label: "Signup",
          description: "Signup definition",
          payload: { kind: "standard-event", eventKey: "sign_up" },
        },
        proposerId: orgA.userId,
        authenticatedUserId: orgA.userId,
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    const rows = await db`SELECT id FROM assistant_memory
      WHERE organization_id = ${orgA.orgId} OR project_id = ${orgB.projectId}`;
    expect(rows).toHaveLength(0);
    // The composite FK backstops raw writes with mismatched provenance.
    await expect(
      db`INSERT INTO assistant_memory
        (id, organization_id, scope, "key", project_id, status, version,
         label, description, payload, created_at, updated_at)
        VALUES ('mem_raw_mix', ${orgA.orgId}, 'project', 'business-term',
          ${orgB.projectId}, 'proposed', 1, 'x', 'x', '{}', 1, 1)`,
    ).rejects.toThrow();
  });
});

run("memory pre-write validation (R12-F5)", () => {
  it("rejects malformed proposals before committing", async () => {
    const tenant = await newTenant("memmalformed");
    await expect(
      proposeMemory(db, {
        organizationId: tenant.orgId,
        scope: "project",
        key: "signup-definition",
        projectId: tenant.projectId,
        value: {
          version: 1,
          label: "Signup",
          description: "Signup definition",
          payload: { kind: "standard-event", eventKey: "sign_up" },
        },
        proposerId: tenant.userId,
        authenticatedUserId: tenant.userId,
        now: -1,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    const rows = await db`SELECT id FROM assistant_memory
      WHERE organization_id = ${tenant.orgId}`;
    expect(rows).toHaveLength(0);
  });
});

run("purge fault isolation (R12-F4)", () => {
  it("leaves all data intact when a purge statement fails", async () => {
    const tenant = await newTenant("purgefault");
    const { createConversationWithFirstMessage } = await import(
      "../utils/assistantStore"
    );
    await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_purgefault_${Date.now()}`,
      firstMessage: "purge me never",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: {
        version: 1,
        label: "NDR",
        description: "Net dollar retention",
        payload: { name: "NDR", description: "Net dollar retention" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    let calls = 0;
    const faulty = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls += 1;
      throw new Error("injected fault");
    }) as never;
    const { purgeAssistantWorkspaceData, purgeAssistantUserData } = await import(
      "../utils/assistantStore"
    );
    await expect(
      purgeAssistantWorkspaceData(faulty, tenant.orgId),
    ).rejects.toThrow("injected fault");
    await expect(
      purgeAssistantUserData(faulty, tenant.userId),
    ).rejects.toThrow("injected fault");
    // Single-statement purges never ran: everything is intact.
    const convs = await db`SELECT id FROM assistant_conversations
      WHERE organization_id = ${tenant.orgId}`;
    expect(convs).toHaveLength(1);
    const mems = await db`SELECT id FROM assistant_memory
      WHERE organization_id = ${tenant.orgId}`;
    expect(mems).toHaveLength(1);
  });
});

run("slot invariants under concurrency (R12-F2)", () => {
  it("holds exactly-one-confirmed under concurrent empty-slot confirms", async () => {
    const tenant = await newTenant("emptyslot");
    const value = (label: string) => ({
      version: 1,
      label,
      description: `${label} definition`,
      payload: { kind: "standard-event", eventKey: "sign_up" },
    });
    const proposals = [];
    for (const label of ["A", "B", "C"]) {
      proposals.push(
        await proposeMemory(db, {
          organizationId: tenant.orgId,
          scope: "project",
          key: "signup-definition",
          projectId: tenant.projectId,
          value: value(label),
          proposerId: tenant.userId,
          authenticatedUserId: tenant.userId,
          now: tick(),
        }),
      );
    }
    // Timing decides the result SHAPE (overlap → some slot-conflict,
    // sequential → last-writer-wins), but the INVARIANTS hold in every
    // interleaving — assert those, not the shape.
    const outcomes = await Promise.all(
      proposals.map((proposal) =>
        confirmMemoryProposal(db, {
          organizationId: tenant.orgId,
          recordId: proposal.id,
          confirmerId: tenant.userId,
          role: "owner",
          now: tick(),
          action: "confirm" as const,
        }),
      ),
    );
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        expect(outcome.reason).toBe("slot-conflict");
      }
    }
    const rows = (await db`SELECT id, status FROM assistant_memory
      WHERE organization_id = ${tenant.orgId}`) as Array<{
      id: unknown;
      status: unknown;
    }>;
    expect(rows.filter((entry) => entry.status === "confirmed")).toHaveLength(1);
    // Audit chains stay valid for every record regardless of interleaving:
    // everything starts proposed; leaving proposed implies a confirm
    // audit; superseded implies one too.
    for (const proposal of proposals) {
      const audit = await readMemoryAudit(db, {
        organizationId: tenant.orgId,
        memoryId: proposal.id,
      });
      const actions = (audit ?? []).map((entry) => entry.action);
      expect(actions[0]).toBe("proposed");
      const current = rows.find((entry) => entry.id === proposal.id)?.status;
      if (current !== "proposed") {
        expect(actions).toContain("confirm");
      }
      if (current === "superseded") {
        expect(actions).toContain("superseded");
      }
    }
  });

  it("converges concurrent member saves to one preference", async () => {
    const tenant = await newTenant("prefsrace");
    const save = (range: string) =>
      proposeMemory(db, {
        organizationId: tenant.orgId,
        scope: "member",
        key: "preferred-comparison-range",
        subjectUserId: tenant.userId,
        value: {
          version: 1,
          label: "Range",
          description: "r",
          payload: { range },
        },
        proposerId: tenant.userId,
        authenticatedUserId: tenant.userId,
        now: tick(),
      });
    // Overlap resolves via the slot invariant + last-writer-wins retry;
    // sequential runs resolve via supersession. Either way both calls
    // succeed and exactly one preference stays confirmed.
    const [first, second] = await Promise.all([save("7d"), save("30d")]);
    expect(first.status).toBe("confirmed");
    expect(second.status).toBe("confirmed");
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.member).toHaveLength(1);
  });
});

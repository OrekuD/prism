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
      now: tick(),
    });
    const confirmed = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: pref.id,
      confirmerId: tenant.userId,
      role: "member",
      now: tick(),
      action: "confirm",
    });
    expect(confirmed.ok).toBe(true);
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
    // Member memory without a subject.
    await expect(
      proposeMemory(db, {
        ...base,
        scope: "member",
        key: "preferred-comparison-range",
        value: {
          version: 1,
          label: "x",
          description: "x",
          payload: { range: "7d" },
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
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
    // Member preference.
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
      now: tick(),
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: pref.id,
      confirmerId: tenant.userId,
      role: "member",
      now: tick(),
      action: "confirm",
    });
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

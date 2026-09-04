/**
 * R13 regression tests (Task 21 slice 4 follow-up).
 *
 * REAL ephemeral PostgreSQL:
 * - R13-F1: populated-0004 upgrade through 0005/0006 + empty upgrade.
 * - R13-F2: user purge with overlapping provenance targets.
 * - R13-F3: project-specific vs workspace-wide member preferences.
 * - R13-F4: run message/conversation binding owned by the database.
 * - R13-F5: normalized business-term slots (sequential + concurrent).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import {
  hasLocalPostgres,
  startEphemeralPostgres,
  startEphemeralPostgresBare,
  applyMigrationFile,
  drizzleFolder,
  type EphemeralPostgres,
} from "./assistantDb";
import {
  LEGACY_REQUEST_DIGEST,
  appendMessage,
  confirmMemoryProposal,
  createConversationWithFirstMessage,
  getConversation,
  proposeMemory,
  purgeAssistantUserData,
  readConfirmedKnowledge,
  readMemoryAudit,
  startRun,
  type AssistantDb,
} from "../utils/assistantStore";

const run = hasLocalPostgres() ? describe : describe.skip;

let pg: EphemeralPostgres | null = null;
let db: AssistantDb;

beforeAll(async () => {
  if (!hasLocalPostgres()) return;
  pg = await startEphemeralPostgres("assistant_r13_test");
  db = pg.sql as unknown as AssistantDb;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

const NOW = 1_785_628_800_000;
let seq = 5000;
const tick = (): number => {
  seq += 1;
  return NOW + seq * 1000;
};

type Tenant = { userId: string; orgId: string; projectId: string };

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

async function secondProject(tenant: Tenant, tag: string): Promise<string> {
  seq += 1;
  const rows = await db`INSERT INTO projects (creator_id, organization_id, name, slug)
    VALUES (${tenant.userId}, ${tenant.orgId}, ${tag}, ${`proj-${tag}-${seq}`}) RETURNING id`;
  return String(rows[0]?.id);
}

run("R13-F1 populated and empty upgrades", () => {
  it("upgrades a populated 0004 database: legacy rows readable, new mismatches fail", async () => {
    const bare = await startEphemeralPostgresBare("r13_upgrade_pop");
    try {
      const folder = drizzleFolder();
      const { readFile, readdir } = await import("node:fs/promises");
      const journalText = await readFile(
        path.join(folder, "meta", "_journal.json"),
        "utf8",
      );
      const { entries } = JSON.parse(journalText) as {
        entries: Array<{ tag: string }>;
      };
      // Apply through 0004 only (0000..0004).
      for (const entry of entries) {
        const idx = entry.tag.split("_")[0];
        if (idx >= "0005") continue;
        const names = (await readdir(folder)).filter(
          (name) => name.startsWith(idx) && name.endsWith(".sql"),
        );
        for (const file of names) {
          await applyMigrationFile(bare.sql as never, path.join(folder, file));
        }
      }
      const raw = bare.sql as unknown as AssistantDb;
      // Legacy 0004 shape: no request_digest column. Insert a conversation
      // and message with idempotency keys the Slice 4 way.
      await raw`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u_leg', 'leg', 'u_leg@example.com', true)`;
      await raw`INSERT INTO organization (id, name, slug, created_at) VALUES ('org_leg', 'leg', 'org_leg-slug', '2026-01-01T00:00:00.000Z')`;
      const proj = (await raw`INSERT INTO projects (creator_id, organization_id, name, slug) VALUES ('u_leg', 'org_leg', 'leg', 'proj-leg-1') RETURNING id`) as Array<{ id: unknown }>;
      const projectId = String(proj[0]?.id);
      await raw`INSERT INTO assistant_conversations (id, organization_id, project_id, user_id, title, client_request_id, created_at, updated_at, last_message_at)
        VALUES ('conv_leg', 'org_leg', ${projectId}, 'u_leg', 'Legacy chat', 'req_leg', 1000, 1000, 1000)`;
      await raw`INSERT INTO assistant_messages (id, conversation_id, seq, role, status, parts, client_request_id, created_at, completed_at)
        VALUES ('msg_leg', 'conv_leg', 0, 'user', 'complete', '[{"type":"text","text":"hi"}]', 'req_leg', 1000, 1000)`;
      // Apply every post-0004 migration file under test, in order.
      const allFiles = await import("node:fs/promises").then((fs) => fs.readdir(folder));
      const pending = allFiles
        .filter((n) => n.endsWith(".sql") && n.split("_")[0] >= "0005")
        .sort();
      expect(pending.length).toBeGreaterThan(0);
      for (const file of pending) {
        await applyMigrationFile(bare.sql as never, path.join(folder, file));
      }
      // Legacy rows carry the explicit sentinel — never NULL.
      const convs = (await raw`SELECT client_request_id AS k, request_digest AS d FROM assistant_conversations WHERE id = 'conv_leg'`) as Array<{ k: unknown; d: unknown }>;
      expect(convs[0]?.k).toBe("req_leg");
      expect(convs[0]?.d).toBe(LEGACY_REQUEST_DIGEST);
      const msgs = (await raw`SELECT client_request_id AS k, request_digest AS d FROM assistant_messages WHERE id = 'msg_leg'`) as Array<{ k: unknown; d: unknown }>;
      expect(msgs[0]?.d).toBe(LEGACY_REQUEST_DIGEST);
      // Rows remain readable through the store.
      const store = bare.sql as unknown as AssistantDb;
      const fetched = await getConversation(store, {
        projectId,
        userId: "u_leg",
        conversationId: "conv_leg",
      });
      expect(fetched?.messages).toHaveLength(1);
      // New mismatched retries on a NEW key fail closed.
      const created = await createConversationWithFirstMessage(store, {
        organizationId: "org_leg",
        projectId,
        userId: "u_leg",
        clientRequestId: "req_leg_new",
        firstMessage: "Original question",
        seed: null,
        queryContextToken: "opaque-server-issued-token",
        now: NOW + 9000,
      });
      expect(created.createdConversation).toBe(true);
      await expect(
        createConversationWithFirstMessage(store, {
          organizationId: "org_leg",
          projectId,
          userId: "u_leg",
          clientRequestId: "req_leg_new",
          firstMessage: "Different question, same key",
          seed: null,
          queryContextToken: "opaque-server-issued-token",
          now: NOW + 9001,
        }),
      ).rejects.toMatchObject({ code: "idempotency-conflict" });
      // Post-migration NULL digests are not valid retries: the pairing
      // CHECK owns this at the database boundary.
      await expect(
        raw`INSERT INTO assistant_messages (id, conversation_id, seq, role, status, parts, client_request_id, request_digest, created_at, completed_at)
          VALUES ('msg_null', 'conv_leg', 99, 'user', 'complete', '[]', 'req_null', NULL, 2000, 2000)`,
      ).rejects.toThrow();
    } finally {
      await bare.stop();
    }
  });

  it("covers the empty upgrade: fresh migrations enforce digests", async () => {
    // The shared suite cluster migrated empty: prove the final CHECKs
    // exist and a fresh keyed write carries a verified digest.
    const tenant = await newTenant("emptyup");
    const created = await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_emptyup_${seq}`,
      firstMessage: "Empty upgrade probe",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    const rows = (await db`SELECT request_digest AS d FROM assistant_conversations WHERE id = ${created.conversation.id}`) as Array<{ d: unknown }>;
    expect(typeof rows[0]?.d).toBe("string");
    expect(String(rows[0]?.d)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(rows[0]?.d)).not.toBe(LEGACY_REQUEST_DIGEST);
  });
});

run("R13-F2 user purge with shared provenance", () => {
  it("tombstones both fields on shared records and drops preferences atomically", async () => {
    const tenant = await newTenant("purgeshared");
    // Member preference (deleted with the user).
    const pref = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      subjectUserId: tenant.userId,
      value: {
        version: 1,
        label: "Range",
        description: "r",
        payload: { range: "7d" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(pref.status).toBe("confirmed");
    // Shared project term where the same user is proposer AND confirmer.
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "business-term",
      projectId: tenant.projectId,
      value: {
        version: 1,
        label: "Shared",
        description: "shared term",
        payload: { name: "SharedTerm", description: "shared term" },
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
    // Second audit actor: append a message so the audit trail is non-trivial.
    const purged = await purgeAssistantUserData(db, tenant.userId);
    expect(purged.memoriesDeleted).toBe(1);
    // Preference and its audit are absent (cascade owns audit deletion).
    const prefRows = (await db`SELECT id FROM assistant_memory WHERE id = ${pref.id}`) as Array<unknown>;
    expect(prefRows).toHaveLength(0);
    const prefAudit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: pref.id,
    });
    expect(prefAudit).toBeNull();
    // Surviving shared record: BOTH provenance fields tombstoned.
    const sharedRows = (await db`SELECT proposer_id AS p, confirmer_id AS c FROM assistant_memory WHERE id = ${proposal.id}`) as Array<{ p: unknown; c: unknown }>;
    expect(sharedRows[0]?.p).toBe("deleted-user");
    expect(sharedRows[0]?.c).toBe("deleted-user");
    const audit = await readMemoryAudit(db, {
      organizationId: tenant.orgId,
      memoryId: proposal.id,
    });
    expect(audit?.length).toBeGreaterThan(0);
    for (const entry of audit ?? []) {
      expect(entry.actorId).toBe("deleted-user");
    }
    // No raw user reference survives anywhere for this user.
    const leftoverMem = (await db`SELECT id FROM assistant_memory WHERE proposer_id = ${tenant.userId} OR confirmer_id = ${tenant.userId}`) as Array<unknown>;
    expect(leftoverMem).toHaveLength(0);
    const leftoverAudit = (await db`SELECT id FROM assistant_memory_audit WHERE actor_id = ${tenant.userId}`) as Array<unknown>;
    expect(leftoverAudit).toHaveLength(0);
    // Repeated execution is stable (idempotent tombstone, zero deletes).
    const again = await purgeAssistantUserData(db, tenant.userId);
    expect(again).toEqual({ conversationsDeleted: 0, memoriesDeleted: 0 });
  });
});

run("R13-F3 member preference applicability", () => {
  it("prefers the project override without leaking across projects", async () => {
    const tenant = await newTenant("prefscope");
    const projectB = await secondProject(tenant, "prefscope-b");
    // Workspace-wide default.
    const global = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      subjectUserId: tenant.userId,
      value: {
        version: 1,
        label: "Range",
        description: "global",
        payload: { range: "7d" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    // Project-A-specific override (newer).
    const specific = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "member",
      key: "preferred-comparison-range",
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
      value: {
        version: 1,
        label: "Range",
        description: "project-a",
        payload: { range: "30d" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(specific.projectId).toBe(tenant.projectId);
    const knowledgeA = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    // One effective value per key: the project override wins.
    expect(knowledgeA.member).toHaveLength(1);
    expect(knowledgeA.member[0]?.id).toBe(specific.id);
    const knowledgeB = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: projectB,
      subjectUserId: tenant.userId,
    });
    // Project B never receives project A's preference: only the default.
    expect(knowledgeB.member).toHaveLength(1);
    expect(knowledgeB.member[0]?.id).toBe(global.id);
  });
});

run("R13-F4 run message binding", () => {
  it("rejects cross-conversation message pairings at the database", async () => {
    const tenant = await newTenant("runbind");
    const chatA = await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_runbind_a_${seq}`,
      firstMessage: "chat A",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    const chatB = await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_runbind_b_${seq}`,
      firstMessage: "chat B",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    // Both IDs are individually valid; the PAIRING is not.
    await expect(
      db`INSERT INTO assistant_runs (id, conversation_id, message_id, project_id, user_id, query_context_hash, definition_version, model, provider, status, step_count, tool_ids, usage, fact_ids, artifact_ids, latency_ms, started_at, completed_at, failure_code)
        VALUES ('run_raw_mix', ${chatA.conversation.id}, ${chatB.message.id}, ${tenant.projectId}, ${tenant.userId}, 'h', 1, 'm', 'openrouter', 'running', 0, '[]', NULL, '[]', '[]', NULL, ${tick()}, NULL, NULL)`,
    ).rejects.toThrow();
    // The store path still inserts nothing for the same mismatch.
    await expect(
      startRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chatA.conversation.id,
        messageId: chatB.message.id,
        queryContextHash: "hash_runbind_mix",
        model: "model-a",
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "not-found" });
    const rows = (await db`SELECT id FROM assistant_runs WHERE conversation_id = ${chatA.conversation.id}`) as Array<unknown>;
    expect(rows).toHaveLength(0);
  });
});

run("R13-F5 normalized business-term slots (R14-F1: database-owned)", () => {
  // R14-F1: exactly one Unicode implementation — the database trigger —
  // ever derives slot identity. These tests assert database behavior and
  // store success (never raw 23514), never JavaScript/database equality.
  const dbCanon = async (name: string): Promise<string> => {
    const rows = (await db`SELECT assistant_canonical_term(${name}) AS v`) as Array<{
      v: unknown;
    }>;
    return String(rows[0]?.v);
  };

  it("accepts the R14 repro strings with display spelling preserved", async () => {
    const tenant = await newTenant("reproslots");
    // The three strings whose JavaScript and PostgreSQL derivations
    // disagreed under the removed dual implementation.
    for (const name of ["İ", "ΟΣ", "A﻿B"]) {
      const proposal = await proposeMemory(db, {
        organizationId: tenant.orgId,
        scope: "workspace",
        key: "business-term",
        value: { version: 1, label: "R", description: "r", payload: { name, description: "r" } },
        proposerId: tenant.userId,
        authenticatedUserId: tenant.userId,
        now: tick(),
      });
      const stored = (await db`SELECT slot_term AS s, payload AS p FROM assistant_memory WHERE id = ${proposal.id}`) as Array<{
        s: unknown;
        p: unknown;
      }>;
      // Stored slot equals the single database derivation...
      expect(String(stored[0]?.s)).toBe(await dbCanon(name));
      // ...while display spelling stays verbatim.
      expect((stored[0]?.p as { name?: unknown })?.name).toBe(name);
      const confirmed = await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: proposal.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      });
      expect(confirmed.ok).toBe(true);
    }
  });

  it("accepts the full ECMAScript whitespace set without raw errors", async () => {
    const tenant = await newTenant("ecmaws");
    const whitespaces = [
      "	",
      "\n",
      "\v",
      "\f",
      "\r",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
      "　",
      "﻿",
    ];
    for (const ws of whitespaces) {
      const name = `A${ws}B`;
      const proposal = await proposeMemory(db, {
        organizationId: tenant.orgId,
        scope: "workspace",
        key: "business-term",
        value: { version: 1, label: "R", description: "r", payload: { name, description: "r" } },
        proposerId: tenant.userId,
        authenticatedUserId: tenant.userId,
        now: tick(),
      });
      const stored = (await db`SELECT slot_term AS s FROM assistant_memory WHERE id = ${proposal.id}`) as Array<{
        s: unknown;
      }>;
      expect(String(stored[0]?.s)).toBe(await dbCanon(name));
    }
  });

  it("supersedes spelling variants within one slot while distinct terms coexist", async () => {
    const tenant = await newTenant("termslot");
    const termValue = (name: string) => ({
      version: 1,
      label: name.trim() || "Term",
      description: `${name} term`,
      payload: { name, description: `${name} term` },
    });
    const first = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: termValue("MRR"),
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
    // Spelling variant of the SAME term supersedes (sequential succession).
    const variant = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: termValue("  mrr "),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    // Display spelling preserved verbatim; slot discriminator normalized.
    const variantRow = (await db`SELECT slot_term AS s FROM assistant_memory WHERE id = ${variant.id}`) as Array<{ s: unknown }>;
    expect(variantRow[0]?.s).toBe("mrr");
    const confirmedVariant = await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: variant.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    expect(confirmedVariant.ok).toBe(true);
    if (!confirmedVariant.ok) throw new Error("expected confirm");
    expect(confirmedVariant.supersededIds).toEqual([first.id]);
    // Genuinely different term coexists in its own slot.
    const other = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: termValue("NDR"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    expect(
      await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: other.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).toMatchObject({ ok: true });
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.workspace.map((entry) => entry.id).sort()).toEqual(
      [variant.id, other.id].sort(),
    );
  });

  it("serializes concurrent spelling-variant confirms to one winner", async () => {
    const tenant = await newTenant("termrace");
    const termValue = (name: string) => ({
      version: 1,
      label: name.trim(),
      description: `${name} term`,
      payload: { name, description: `${name} term` },
    });
    const a = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: termValue("Churn"),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const b = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: termValue("  CHURN "),
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    const outcomes = await Promise.all([
      confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: a.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm" as const,
      }),
      confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: b.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm" as const,
      }),
    ]);
    const okCount = outcomes.filter((entry) => entry.ok).length;
    // Timing decides sequential-succession (2 ok, last wins) vs overlap
    // (1 ok + slot-conflict); the invariant holds in every interleaving.
    expect([1, 2]).toContain(okCount);
    for (const outcome of outcomes) {
      if (!outcome.ok) expect(outcome.reason).toBe("slot-conflict");
    }
    const rows = (await db`SELECT id, status FROM assistant_memory WHERE organization_id = ${tenant.orgId} AND scope = 'workspace' AND key = 'business-term'`) as Array<{
      id: unknown;
      status: unknown;
    }>;
    expect(rows.filter((entry) => entry.status === "confirmed")).toHaveLength(1);
  });
});

run("R14-F2 legacy sentinel fails closed", () => {
  it("rejects creation retries on sentinel-backed keys without mutating storage", async () => {
    const owner = await newTenant("legacyclosed");
    const created = await createConversationWithFirstMessage(db, {
      organizationId: owner.orgId,
      projectId: owner.projectId,
      userId: owner.userId,
      clientRequestId: `req_legacyclosed_${seq}`,
      firstMessage: "Original question",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    // Simulate a 0004-era row: backfilled sentinel, original inputs gone.
    await db`UPDATE assistant_conversations SET request_digest = ${LEGACY_REQUEST_DIGEST} WHERE id = ${created.conversation.id}`;
    await db`UPDATE assistant_messages SET request_digest = ${LEGACY_REQUEST_DIGEST} WHERE conversation_id = ${created.conversation.id}`;
    const countConvs = async (): Promise<number> =>
      Number(
        (
          (await db`SELECT COUNT(*) AS n FROM assistant_conversations WHERE project_id = ${owner.projectId} AND user_id = ${owner.userId}`) as Array<{
            n: unknown;
          }>
        )[0]?.n,
      );
    const countMsgs = async (): Promise<number> =>
      Number(
        (
          (await db`SELECT COUNT(*) AS n FROM assistant_messages WHERE conversation_id = ${created.conversation.id}`) as Array<{
            n: unknown;
          }>
        )[0]?.n,
      );
    expect(await countConvs()).toBe(1);
    expect(await countMsgs()).toBe(1);
    // Nominally identical retry: still not a verified replay.
    await expect(
      createConversationWithFirstMessage(db, {
        organizationId: owner.orgId,
        projectId: owner.projectId,
        userId: owner.userId,
        clientRequestId: created.message.clientRequestId as string,
        firstMessage: "Original question",
        seed: null,
        queryContextToken: "opaque-server-issued-token",
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    // Different content: also a conflict, never a silent alias.
    await expect(
      createConversationWithFirstMessage(db, {
        organizationId: owner.orgId,
        projectId: owner.projectId,
        userId: owner.userId,
        clientRequestId: created.message.clientRequestId as string,
        firstMessage: "Unrelated question",
        seed: null,
        queryContextToken: "opaque-server-issued-token",
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    // Neither attempt mutated storage.
    expect(await countConvs()).toBe(1);
    expect(await countMsgs()).toBe(1);
    // History reads stay usable: the legacy chat is still readable.
    const fetched = await getConversation(db, {
      projectId: owner.projectId,
      userId: owner.userId,
      conversationId: created.conversation.id,
    });
    expect(fetched?.messages).toHaveLength(1);
  });

  it("rejects message-append retries on sentinel-backed keys", async () => {
    const owner = await newTenant("legacyappend");
    const chat = await createConversationWithFirstMessage(db, {
      organizationId: owner.orgId,
      projectId: owner.projectId,
      userId: owner.userId,
      clientRequestId: `req_legacyappend_${seq}`,
      firstMessage: "hello",
      seed: null,
      queryContextToken: "opaque-server-issued-token",
      now: tick(),
    });
    const appended = await appendMessage(db, {
      projectId: owner.projectId,
      userId: owner.userId,
      conversationId: chat.conversation.id,
      role: "user",
      status: "complete",
      parts: [{ type: "text" as const, text: "follow-up" }],
      clientRequestId: `req_legacyappend_msg_${seq}`,
      now: tick(),
    });
    expect(appended.created).toBe(true);
    const msgKey = appended.message.clientRequestId as string;
    await db`UPDATE assistant_messages SET request_digest = ${LEGACY_REQUEST_DIGEST} WHERE conversation_id = ${chat.conversation.id} AND client_request_id = ${msgKey}`;
    const countMsgs = async (): Promise<number> =>
      Number(
        (
          (await db`SELECT COUNT(*) AS n FROM assistant_messages WHERE conversation_id = ${chat.conversation.id}`) as Array<{
            n: unknown;
          }>
        )[0]?.n,
      );
    expect(await countMsgs()).toBe(2);
    await expect(
      appendMessage(db, {
        projectId: owner.projectId,
        userId: owner.userId,
        conversationId: chat.conversation.id,
        role: "user",
        status: "complete",
        parts: [{ type: "text" as const, text: "follow-up" }],
        clientRequestId: msgKey,
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    await expect(
      appendMessage(db, {
        projectId: owner.projectId,
        userId: owner.userId,
        conversationId: chat.conversation.id,
        role: "user",
        status: "complete",
        parts: [{ type: "text" as const, text: "different" }],
        clientRequestId: msgKey,
        now: tick(),
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(await countMsgs()).toBe(2);
  });
});

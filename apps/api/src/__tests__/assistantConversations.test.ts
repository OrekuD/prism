/**
 * Slice 4 conversation/message/run storage tests (Task 21 slice 4).
 *
 * REAL ephemeral PostgreSQL (see `assistantDb.ts`) — no mocks. Unique
 * constraints, partial unique indexes, FK cascades, and genuinely
 * concurrent connections exercise the same SQL the Worker runs.
 * Skipped only when local Postgres binaries are unavailable.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  hasLocalPostgres,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from "./assistantDb";
import {
  appendMessage,
  confirmMemoryProposal,
  createConversationWithFirstMessage,
  deleteConversation,
  finishRun,
  getAssistantRetentionConfig,
  getConversation,
  listConversations,
  proposeMemory,
  purgeAssistantRetention,
  readConfirmedKnowledge,
  selectRecentTurns,
  startRun,
  type AssistantDb,
} from "../utils/assistantStore";
import { encodeConversationCursor } from "@prism-analytics/types";

const run = hasLocalPostgres() ? describe : describe.skip;

let pg: EphemeralPostgres | null = null;
let db: AssistantDb;

beforeAll(async () => {
  if (!hasLocalPostgres()) return;
  pg = await startEphemeralPostgres("assistant_conv_test");
  db = pg.sql as unknown as AssistantDb;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

const NOW = 1_785_628_800_000;
const TOKEN = "opaque-server-issued-token";
let seq = 0;
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
  const slug = `proj-${tag}-${seq}`;
  await db`INSERT INTO "user" (id, name, email, email_verified)
    VALUES (${userId}, ${tag}, ${`${userId}@example.com`}, true)`;
  await db`INSERT INTO organization (id, name, slug, created_at)
    VALUES (${orgId}, ${tag}, ${`${orgId}-slug`}, ${new Date(NOW).toISOString()})`;
  await db`INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`m_${tag}_${seq}`}, ${orgId}, ${userId}, 'member', ${new Date(NOW).toISOString()})`;
  const rows = await db`INSERT INTO projects (creator_id, organization_id, name, slug)
    VALUES (${userId}, ${orgId}, ${tag}, ${slug}) RETURNING id`;
  return { userId, orgId, projectId: String(rows[0]?.id) };
}

async function newChat(tenant: Tenant, firstMessage = "What changed this week?") {
  return createConversationWithFirstMessage(db, {
    organizationId: tenant.orgId,
    projectId: tenant.projectId,
    userId: tenant.userId,
    clientRequestId: `req_${seq}_${Math.random().toString(36).slice(2)}`,
    firstMessage,
    seed: null,
    queryContextToken: TOKEN,
    now: tick(),
  });
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected rejection with code ${code}`);
}

/** Wrap the store so the Nth database call throws (fault injection). */
function failingDb(db: AssistantDb, failOnCalls: number[]): AssistantDb {
  let calls = 0;
  return (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls += 1;
    if (failOnCalls.includes(calls)) throw new Error("injected fault");
    return db(strings, ...values);
  }) as AssistantDb;
}

run("conversation lifecycle", () => {
  it("lazy-creates a chat with its first message atomically", async () => {
    const tenant = await newTenant("lazy");
    const before = await db`SELECT COUNT(*) AS n FROM assistant_conversations`;
    expect(Number(before[0]?.n)).toBeGreaterThanOrEqual(0);
    const result = await newChat(tenant, "Why did signups spike?");
    expect(result.createdConversation).toBe(true);
    expect(result.createdMessage).toBe(true);
    expect(result.conversation.title).toBe("Why did signups spike?");
    expect(result.conversation.projectId).toBe(tenant.projectId);
    expect(result.conversation.userId).toBe(tenant.userId);
    expect(result.conversation.seed).toBeNull();
    expect(result.message.seq).toBe(0);
    expect(result.message.role).toBe("user");
    expect(result.message.status).toBe("complete");
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: result.conversation.id,
    });
    expect(fetched?.messages).toHaveLength(1);
    expect(fetched?.activeRun).toBeNull();
  });

  it("derives deterministic titles without a model call", async () => {
    const tenant = await newTenant("titles");
    const long = await newChat(tenant, `Explain ${"x".repeat(200)} please`);
    expect(long.conversation.title.length).toBeLessThanOrEqual(60);
    expect(long.conversation.title.endsWith("…")).toBe(true);
    const spaced = await newChat(tenant, "  How   are\nwe   doing?  ");
    expect(spaced.conversation.title).toBe("How are we doing?");
  });

  it("persists insight seed references", async () => {
    const tenant = await newTenant("seed");
    const result = await createConversationWithFirstMessage(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: `req_seed_${seq}`,
      firstMessage: "Tell me more about this change",
      seed: { type: "insight", insightId: "change-abc123" },
      queryContextToken: TOKEN,
      now: tick(),
    });
    expect(result.conversation.seed).toEqual({
      type: "insight",
      insightId: "change-abc123",
    });
  });

  it("rejects invalid creation input", async () => {
    const tenant = await newTenant("invalid");
    const base = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_bad",
      firstMessage: "Hello",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    await rejectsWithCode(
      createConversationWithFirstMessage(db, { ...base, firstMessage: "" }),
      "invalid-input",
    );
    await rejectsWithCode(
      createConversationWithFirstMessage(db, {
        ...base,
        firstMessage: "x".repeat(2001),
      }),
      "invalid-input",
    );
    await rejectsWithCode(
      createConversationWithFirstMessage(db, {
        ...base,
        queryContextToken: "",
      }),
      "invalid-input",
    );
  });
});

run("idempotent creation and submission", () => {
  it("duplicate creation converges sequentially", async () => {
    const tenant = await newTenant("dupseq");
    const input = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_dupseq",
      firstMessage: "Same submit twice",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    const first = await createConversationWithFirstMessage(db, input);
    const second = await createConversationWithFirstMessage(db, {
      ...input,
      now: tick(),
    });
    expect(second.createdConversation).toBe(false);
    expect(second.createdMessage).toBe(false);
    expect(second.conversation.id).toBe(first.conversation.id);
    expect(second.message.id).toBe(first.message.id);
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: first.conversation.id,
    });
    expect(fetched?.messages).toHaveLength(1);
  });

  it("duplicate creation converges concurrently across tabs", async () => {
    const tenant = await newTenant("dupcon");
    const input = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_dupcon",
      firstMessage: "Two tabs at once",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        createConversationWithFirstMessage(db, { ...input }),
      ),
    );
    const ids = new Set(results.map((entry) => entry.conversation.id));
    const msgIds = new Set(results.map((entry) => entry.message.id));
    expect(ids.size).toBe(1);
    expect(msgIds.size).toBe(1);
    expect(results.filter((entry) => entry.createdConversation)).toHaveLength(1);
  });

  it("retried submissions converge on one message", async () => {
    const tenant = await newTenant("resub");
    const chat = await newChat(tenant);
    const input = {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "Follow-up question" }],
      clientRequestId: "req_followup",
      now: tick(),
    };
    const first = await appendMessage(db, input);
    const second = await appendMessage(db, { ...input, now: tick() });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.seq).toBe(first.message.seq);
  });
});

run("atomic message sequencing", () => {
  it("assigns gapless seq values in order", async () => {
    const tenant = await newTenant("seq");
    const chat = await newChat(tenant);
    for (let index = 0; index < 3; index += 1) {
      await appendMessage(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
        role: index % 2 === 0 ? "assistant" : "user",
        status: "complete",
        parts: [{ type: "text", text: `turn ${index}` }],
        now: tick(),
      });
    }
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    expect(fetched?.messages.map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);
  });

  it("serializes concurrent appends without gaps or duplicates", async () => {
    const tenant = await newTenant("seqcon");
    const chat = await newChat(tenant);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendMessage(db, {
          projectId: tenant.projectId,
          userId: tenant.userId,
          conversationId: chat.conversation.id,
          role: "user",
          status: "complete",
          parts: [{ type: "text", text: `parallel ${index}` }],
          now: tick(),
        }),
      ),
    );
    expect(results.every((entry) => entry.created)).toBe(true);
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    const seqs = (fetched?.messages ?? []).map((entry) => entry.seq).sort();
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("rejects invalid messages and foreign chats", async () => {
    const tenant = await newTenant("msgbad");
    const stranger = await newTenant("msgstranger");
    const chat = await newChat(tenant);
    const base = {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "ok" }],
      now: tick(),
    };
    await rejectsWithCode(
      appendMessage(db, { ...base, role: "system" as never }),
      "invalid-input",
    );
    await rejectsWithCode(
      appendMessage(db, {
        ...base,
        parts: Array.from({ length: 17 }, () => ({
          type: "text" as const,
          text: "x",
        })),
      }),
      "invalid-input",
    );
    await rejectsWithCode(
      appendMessage(db, {
        ...base,
        projectId: stranger.projectId,
        userId: stranger.userId,
      }),
      "not-found",
    );
    await rejectsWithCode(
      appendMessage(db, { ...base, conversationId: "conv_missing" }),
      "not-found",
    );
  });
});

run("history listing and cursors", () => {
  it("orders most-recent-first with chats-without-messages last", async () => {
    const tenant = await newTenant("order");
    const first = await newChat(tenant, "first chat");
    await newChat(tenant, "second chat");
    // A chat row with no messages sorts after every messaged chat.
    await db`INSERT INTO assistant_conversations
      (id, organization_id, project_id, user_id, title, created_at, updated_at, last_message_at)
      VALUES ('conv_empty_order', ${tenant.orgId}, ${tenant.projectId}, ${tenant.userId}, 'Empty', ${tick()}, ${tick()}, NULL)`;
    // Touch the first chat so it becomes most recent.
    await appendMessage(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: first.conversation.id,
      role: "user",
      status: "complete",
      parts: [{ type: "text", text: "bump" }],
      now: tick(),
    });
    const page = await listConversations(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      limit: 10,
    });
    expect(page.items.map((entry) => entry.title)).toEqual([
      first.conversation.title,
      "second chat",
      "Empty",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates deterministically across cursor boundaries", async () => {
    const tenant = await newTenant("pages");
    const titles: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const chat = await newChat(tenant, `chat ${index}`);
      titles.push(chat.conversation.title);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const result = await listConversations(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        limit: 2,
        cursor,
      });
      seen.push(...result.items.map((entry) => entry.title));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }
    // Newest first.
    expect(seen).toEqual([...titles].reverse());
    expect(cursor).toBeNull();
  });

  it("walks into the null region after messaged chats", async () => {
    const tenant = await newTenant("nullpage");
    await newChat(tenant, "only messaged");
    await db`INSERT INTO assistant_conversations
      (id, organization_id, project_id, user_id, title, created_at, updated_at, last_message_at)
      VALUES ('conv_e1_nullpage', ${tenant.orgId}, ${tenant.projectId}, ${tenant.userId}, 'Empty A', ${tick()}, ${tick()}, NULL)`;
    await db`INSERT INTO assistant_conversations
      (id, organization_id, project_id, user_id, title, created_at, updated_at, last_message_at)
      VALUES ('conv_e2_nullpage', ${tenant.orgId}, ${tenant.projectId}, ${tenant.userId}, 'Empty B', ${tick()}, ${tick()}, NULL)`;
    const first = await listConversations(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      limit: 2,
    });
    expect(first.items.map((entry) => entry.title)).toEqual([
      "only messaged",
      "Empty B",
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listConversations(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((entry) => entry.title)).toEqual(["Empty A"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects tampered cursors", async () => {
    const tenant = await newTenant("cursorbad");
    await rejectsWithCode(
      listConversations(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        cursor: "not-a-cursor",
      }),
      "invalid-input",
    );
    const tampered = encodeConversationCursor({
      lastMessageAt: 1,
      id: "x",
    }).slice(0, -2);
    await rejectsWithCode(
      listConversations(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        cursor: tampered,
      }),
      "invalid-input",
    );
  });

  it("reports message counts and active-run flags", async () => {
    const tenant = await newTenant("flags");
    const chat = await newChat(tenant);
    await appendMessage(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "assistant",
      status: "streaming",
      parts: [{ type: "text", text: "working" }],
      clientRequestId: "req_stream",
      now: tick(),
    });
    const started = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_flags",
      model: "model-a",
      now: tick(),
    });
    expect(started.ok).toBe(true);
    const page = await listConversations(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
    });
    const item = page.items.find(
      (entry) => entry.id === chat.conversation.id,
    );
    expect(item?.messageCount).toBe(2);
    expect(item?.hasActiveRun).toBe(true);
  });
});

run("one active run", () => {
  it("refuses a second running run and resumes after finish", async () => {
    const tenant = await newTenant("runlimit");
    const first = await newChat(tenant, "first");
    const second = await newChat(tenant, "second");
    const started = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: first.conversation.id,
      messageId: first.message.id,
      queryContextHash: "hash_one",
      model: "model-a",
      now: tick(),
    });
    if (!started.ok) throw new Error("expected run to start");
    const blocked = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: second.conversation.id,
      messageId: second.message.id,
      queryContextHash: "hash_two",
      model: "model-a",
      now: tick(),
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected conflict");
    expect(blocked.conflict.code).toBe("active-run-exists");
    expect(blocked.conflict.activeRunId).toBe(started.run.id);
    expect(blocked.conflict.activeConversationId).toBe(first.conversation.id);
    const done = await finishRun(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      runId: started.run.id,
      status: "complete",
      stepCount: 2,
      toolIds: ["measure_metric"],
      factIds: ["fact_1"],
      artifactIds: ["art_1"],
      latencyMs: 1200,
      now: tick(),
    });
    expect(done.finished).toBe(true);
    expect(done.run.status).toBe("complete");
    const retry = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: second.conversation.id,
      messageId: second.message.id,
      queryContextHash: "hash_two",
      model: "model-a",
      now: tick(),
    });
    expect(retry.ok).toBe(true);
  });

  it("starts exactly one run across concurrent tabs", async () => {
    const tenant = await newTenant("runrace");
    const chat = await newChat(tenant);
    const attempts = await Promise.all(
      [1, 2, 3].map((index) =>
        startRun(db, {
                    projectId: tenant.projectId,
          userId: tenant.userId,
          conversationId: chat.conversation.id,
          messageId: chat.message.id,
          queryContextHash: `hash_race_${index}`,
          model: "model-a",
          now: tick(),
        }),
      ),
    );
    expect(attempts.filter((entry) => entry.ok)).toHaveLength(1);
    expect(attempts.filter((entry) => !entry.ok)).toHaveLength(2);
  });

  it("re-finishing is idempotent and foreign runs stay hidden", async () => {
    const tenant = await newTenant("refinish");
    const stranger = await newTenant("refinstranger");
    const chat = await newChat(tenant);
    const started = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_refinish",
      model: "model-a",
      now: tick(),
    });
    if (!started.ok) throw new Error("expected run to start");
    const first = await finishRun(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      runId: started.run.id,
      status: "cancelled",
      now: tick(),
    });
    const second = await finishRun(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      runId: started.run.id,
      status: "cancelled",
      now: tick(),
    });
    expect(first.finished).toBe(true);
    expect(second.finished).toBe(false);
    expect(second.run.status).toBe("cancelled");
    await rejectsWithCode(
      finishRun(db, {
        projectId: stranger.projectId,
        userId: stranger.userId,
        runId: started.run.id,
        status: "complete",
        now: tick(),
      }),
      "not-found",
    );
  });

  it("rejects invalid run input", async () => {
    const tenant = await newTenant("runbad");
    const chat = await newChat(tenant);
    const base = {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_bad",
      model: "model-a",
      now: tick(),
    };
    await rejectsWithCode(
      startRun(db, { ...base, messageId: "msg_missing" }),
      "not-found",
    );
    await rejectsWithCode(
      startRun(db, { ...base, queryContextHash: "" }),
      "invalid-input",
    );
    const started = await startRun(db, base);
    if (!started.ok) throw new Error("expected run to start");
    await rejectsWithCode(
      finishRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        runId: started.run.id,
        status: "complete",
        toolIds: ["nope"],
        now: tick(),
      }),
      "invalid-input",
    );
    await rejectsWithCode(
      finishRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        runId: started.run.id,
        status: "complete",
        stepCount: 7,
        now: tick(),
      }),
      "invalid-input",
    );
  });
});

run("chat deletion", () => {
  it("deletes messages and runs but keeps confirmed memory", async () => {
    const tenant = await newTenant("delchat");
    const chat = await newChat(tenant);
    const started = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_del",
      model: "model-a",
      now: tick(),
    });
    if (!started.ok) throw new Error("expected run to start");
    const proposal = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "business-term",
      projectId: tenant.projectId,
      value: {
        version: 1,
        label: "Churn",
        description: "Cancelled subscriptions",
        payload: { name: "Churn", description: "Cancelled subscriptions" },
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
    const deleted = await deleteConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    expect(deleted).toEqual({ deleted: true, abortedRun: true });
    expect(
      await getConversation(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
      }),
    ).toBeNull();
    const runs = await db`SELECT * FROM assistant_runs WHERE id = ${started.run.id}`;
    expect(runs).toHaveLength(0);
    // A new run can start: the aborted run holds no slot.
    const fresh = await newChat(tenant, "after deletion");
    const restart = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: fresh.conversation.id,
      messageId: fresh.message.id,
      queryContextHash: "hash_after",
      model: "model-a",
      now: tick(),
    });
    expect(restart.ok).toBe(true);
  });

  it("reports missing and foreign chats without disclosing", async () => {
    const tenant = await newTenant("delmissing");
    const stranger = await newTenant("delstranger");
    const chat = await newChat(tenant);
    expect(
      await deleteConversation(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: "conv_missing",
      }),
    ).toEqual({ deleted: false, abortedRun: false });
    expect(
      await deleteConversation(db, {
        projectId: stranger.projectId,
        userId: stranger.userId,
        conversationId: chat.conversation.id,
      }),
    ).toEqual({ deleted: false, abortedRun: false });
    expect(
      await getConversation(db, {
        projectId: stranger.projectId,
        userId: stranger.userId,
        conversationId: chat.conversation.id,
      }),
    ).toBeNull();
    const plain = await deleteConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    expect(plain).toEqual({ deleted: true, abortedRun: false });
  });
});

run("authorization isolation", () => {
  it("members cannot read each other's chats", async () => {
    const alice = await newTenant("alice");
    const bob = await newTenant("bob");
    const chat = await newChat(alice, "Alice private question");
    expect(
      await getConversation(db, {
        projectId: alice.projectId,
        userId: bob.userId,
        conversationId: chat.conversation.id,
      }),
    ).toBeNull();
    const page = await listConversations(db, {
      projectId: alice.projectId,
      userId: bob.userId,
    });
    expect(page.items).toHaveLength(0);
  });

  it("chats do not leak across projects", async () => {
    const tenant = await newTenant("leak");
    const otherProject = await db`INSERT INTO projects (creator_id, organization_id, name, slug)
      VALUES (${tenant.userId}, ${tenant.orgId}, 'other', ${`other-${seq}`}) RETURNING id`;
    const otherId = String(otherProject[0]?.id);
    const chat = await newChat(tenant);
    expect(
      await getConversation(db, {
        projectId: otherId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
      }),
    ).toBeNull();
    const page = await listConversations(db, {
      projectId: otherId,
      userId: tenant.userId,
    });
    expect(page.items).toHaveLength(0);
  });
});

run("recent-turn selection", () => {
  it("keeps the trailing window from the selected chat only", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      seq: index,
      text: `m${index}`,
    }));
    const windowed = selectRecentTurns(messages);
    expect(windowed.messages).toHaveLength(8);
    expect(windowed.messages[0]?.seq).toBe(12);
    expect(windowed.truncated).toBe(true);
    expect(windowed.omittedCount).toBe(12);
    const short = selectRecentTurns(messages.slice(0, 3));
    expect(short.truncated).toBe(false);
    expect(short.omittedCount).toBe(0);
    const custom = selectRecentTurns(messages, { limit: 100 });
    expect(custom.messages).toHaveLength(12);
    const one = selectRecentTurns(messages, { limit: 0 });
    expect(one.messages).toHaveLength(1);
  });
});

run("retention and project purge", () => {
  it("purges finished runs by age but never running ones", async () => {
    const tenant = await newTenant("retention");
    const old = NOW - 100 * 86_400_000;
    const mkRun = async (status: "complete" | "running", at: number) => {
      const chat = await newChat(tenant, `retention ${status} ${at}`);
      const started = await startRun(db, {
                projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
        messageId: chat.message.id,
        queryContextHash: `hash_ret_${at}_${status}`,
        model: "model-a",
        now: at,
      });
      if (!started.ok) throw new Error("expected run to start");
      if (status === "complete") {
        await finishRun(db, {
          projectId: tenant.projectId,
          userId: tenant.userId,
          runId: started.run.id,
          status: "complete",
          now: at + 1000,
        });
      }
      return started.run.id;
    };
    const oldFinished = await mkRun("complete", old);
    await mkRun("complete", NOW);
    const chat = await newChat(tenant, "retention running");
    const running = await startRun(db, {
            projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_ret_running",
      model: "model-a",
      now: old,
    });
    if (!running.ok) throw new Error("expected run to start");
    const config = getAssistantRetentionConfig({});
    expect(config.runRetentionDays).toBe(90);
    const purged = await purgeAssistantRetention(db, NOW, config);
    expect(purged.runsDeleted).toBe(1);
    const remaining = await db`SELECT id FROM assistant_runs WHERE project_id = ${tenant.projectId}`;
    const ids = new Set(remaining.map((entry) => String(entry.id)));
    expect(ids.has(oldFinished)).toBe(false);
    expect(ids.has(running.run.id)).toBe(true);
    expect(getAssistantRetentionConfig({ PRISM_ASSISTANT_RUN_RETENTION_DAYS: "7" }).runRetentionDays).toBe(7);
    expect(getAssistantRetentionConfig({ PRISM_ASSISTANT_RUN_RETENTION_DAYS: "0" }).runRetentionDays).toBe(90);
  });

  it("cascades project chats and project memory with the project row (R12-F4)", async () => {
    const tenant = await newTenant("projpurge");
    const chat = await newChat(tenant);
    const projectTerm = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "project",
      key: "business-term",
      projectId: tenant.projectId,
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
    expect(
      await confirmMemoryProposal(db, {
        organizationId: tenant.orgId,
        recordId: projectTerm.id,
        confirmerId: tenant.userId,
        role: "owner",
        now: tick(),
        action: "confirm",
      }),
    ).toMatchObject({ ok: true });
    const shared = await proposeMemory(db, {
      organizationId: tenant.orgId,
      scope: "workspace",
      key: "business-term",
      value: {
        version: 1,
        label: "ARR",
        description: "Annual recurring revenue",
        payload: { name: "ARR", description: "Annual recurring revenue" },
      },
      proposerId: tenant.userId,
      authenticatedUserId: tenant.userId,
      now: tick(),
    });
    await confirmMemoryProposal(db, {
      organizationId: tenant.orgId,
      recordId: shared.id,
      confirmerId: tenant.userId,
      role: "owner",
      now: tick(),
      action: "confirm",
    });
    // The owning product-row deletion is the single boundary: one
    // statement removes the project, its chats (messages/runs cascade),
    // and its project memory (audit cascades).
    await db`DELETE FROM projects WHERE id = ${tenant.projectId}`;
    expect(
      await getConversation(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
      }),
    ).toBeNull();
    const leftoverRuns = await db`SELECT id FROM assistant_runs WHERE user_id = ${tenant.userId}`;
    expect(leftoverRuns).toHaveLength(0);
    const leftoverMem = await db`SELECT id FROM assistant_memory WHERE organization_id = ${tenant.orgId}`;
    expect(leftoverMem.map((entry) => String(entry.id))).toEqual([shared.id]);
    const knowledge = await readConfirmedKnowledge(db, {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      subjectUserId: tenant.userId,
    });
    expect(knowledge.project).toHaveLength(0);
    expect(knowledge.workspace.map((entry) => entry.id)).toContain(shared.id);
  });
});

run("atomic creation evidence (R12-F1)", () => {
  it("leaves neither row when the single write statement fails", async () => {
    const tenant = await newTenant("faultcreate");
    const input = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_faultcreate",
      firstMessage: "Will this persist halfway?",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    // Call 1 is the project ownership read; call 2 is the atomic
    // create-with-first-message statement. Failing it must persist
    // nothing: there is no second statement to strand an empty chat.
    await expect(
      createConversationWithFirstMessage(failingDb(db, [2]), input),
    ).rejects.toThrow("injected fault");
    const convs = await db`SELECT id FROM assistant_conversations
      WHERE project_id = ${tenant.projectId} AND user_id = ${tenant.userId}`;
    expect(convs).toHaveLength(0);
    // The operation still succeeds once the fault clears.
    const healed = await createConversationWithFirstMessage(db, input);
    expect(healed.createdConversation).toBe(true);
    expect(healed.message.seq).toBe(0);
  });

  it("rejects a reused creation key with different content (R12-F6)", async () => {
    const tenant = await newTenant("digestcreate");
    const base = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_digestcreate",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    const first = await createConversationWithFirstMessage(db, {
      ...base,
      firstMessage: "Original question",
    });
    expect(first.createdConversation).toBe(true);
    await rejectsWithCode(
      createConversationWithFirstMessage(db, {
        ...base,
        firstMessage: "Different question, same key",
        now: tick(),
      }),
      "idempotency-conflict",
    );
    await rejectsWithCode(
      createConversationWithFirstMessage(db, {
        ...base,
        firstMessage: "Original question",
        seed: { type: "insight", insightId: "other" },
        now: tick(),
      }),
      "idempotency-conflict",
    );
    // Exactly one conversation and one message exist.
    const convs = await db`SELECT id FROM assistant_conversations
      WHERE project_id = ${tenant.projectId} AND user_id = ${tenant.userId}`;
    expect(convs).toHaveLength(1);
    const msgs = await db`SELECT id FROM assistant_messages
      WHERE conversation_id = ${first.conversation.id}`;
    expect(msgs).toHaveLength(1);
  });

  it("resolves concurrent same-key/different-payload creates deterministically", async () => {
    const tenant = await newTenant("digestrace");
    const base = {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      userId: tenant.userId,
      clientRequestId: "req_digestrace",
      seed: null,
      queryContextToken: TOKEN,
      now: tick(),
    };
    const outcomes = await Promise.allSettled([
      createConversationWithFirstMessage(db, {
        ...base,
        firstMessage: "Tab A question",
      }),
      createConversationWithFirstMessage(db, {
        ...base,
        firstMessage: "Tab B question",
      }),
    ]);
    const fulfilled = outcomes.filter(
      (entry) => entry.status === "fulfilled",
    );
    const rejected = outcomes.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason?.code,
    ).toBe("idempotency-conflict");
    const convs = await db`SELECT id FROM assistant_conversations
      WHERE project_id = ${tenant.projectId} AND user_id = ${tenant.userId}`;
    expect(convs).toHaveLength(1);
  });
});

run("message digest conflicts (R12-F6)", () => {
  it("rejects reused message keys with different content", async () => {
    const tenant = await newTenant("digestmsg");
    const chat = await newChat(tenant);
    const base = {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "user" as const,
      status: "complete" as const,
      clientRequestId: "req_digestmsg",
      now: tick(),
    };
    const first = await appendMessage(db, {
      ...base,
      parts: [{ type: "text" as const, text: "Original" }],
    });
    expect(first.created).toBe(true);
    await rejectsWithCode(
      appendMessage(db, {
        ...base,
        parts: [{ type: "text" as const, text: "Different" }],
        now: tick(),
      }),
      "idempotency-conflict",
    );
    await rejectsWithCode(
      appendMessage(db, {
        ...base,
        role: "assistant",
        parts: [{ type: "text" as const, text: "Original" }],
        now: tick(),
      }),
      "idempotency-conflict",
    );
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    expect(fetched?.messages).toHaveLength(2);
  });

  it("resolves concurrent same-key/different-payload appends", async () => {
    const tenant = await newTenant("digestmsgrace");
    const chat = await newChat(tenant);
    const base = {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "user" as const,
      status: "complete" as const,
      clientRequestId: "req_digestmsgrace",
      now: tick(),
    };
    const outcomes = await Promise.allSettled([
      appendMessage(db, {
        ...base,
        parts: [{ type: "text" as const, text: "Tab A" }],
      }),
      appendMessage(db, {
        ...base,
        parts: [{ type: "text" as const, text: "Tab B" }],
      }),
    ]);
    expect(
      outcomes.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.filter(
      (entry) => entry.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason?.code,
    ).toBe("idempotency-conflict");
  });
});

run("tenant write isolation (R12-F3)", () => {
  it("fails cross-tenant writes without inserting a row", async () => {
    const orgA = await newTenant("tena");
    const orgB = await newTenant("tenb");
    // Organization A paired with project B.
    await rejectsWithCode(
      createConversationWithFirstMessage(db, {
        organizationId: orgA.orgId,
        projectId: orgB.projectId,
        userId: orgA.userId,
        clientRequestId: "req_tenantmix",
        firstMessage: "Mixed tenant write",
        seed: null,
        queryContextToken: TOKEN,
        now: tick(),
      }),
      "invalid-input",
    );
    const mixed = await db`SELECT id FROM assistant_conversations
      WHERE project_id = ${orgB.projectId}`;
    expect(mixed).toHaveLength(0);
    // A run scoped to A over B's chat inserts nothing.
    const chatB = await newChat(orgB);
    await rejectsWithCode(
      startRun(db, {
        projectId: orgA.projectId,
        userId: orgA.userId,
        conversationId: chatB.conversation.id,
        messageId: chatB.message.id,
        queryContextHash: "hash_tenantmix",
        model: "model-a",
        now: tick(),
      }),
      "not-found",
    );
    const runsB = await db`SELECT id FROM assistant_runs
      WHERE conversation_id = ${chatB.conversation.id}`;
    expect(runsB).toHaveLength(0);
    // A message from another conversation cannot back a run.
    const chatA = await newChat(orgA);
    await rejectsWithCode(
      startRun(db, {
        projectId: orgA.projectId,
        userId: orgA.userId,
        conversationId: chatA.conversation.id,
        messageId: chatB.message.id,
        queryContextHash: "hash_msgmix",
        model: "model-a",
        now: tick(),
      }),
      "not-found",
    );
    const runsA = await db`SELECT id FROM assistant_runs
      WHERE conversation_id = ${chatA.conversation.id}`;
    expect(runsA).toHaveLength(0);
  });
});

run("pre-write validation (R12-F5)", () => {
  it("rejects malformed writes before committing anything", async () => {
    const tenant = await newTenant("malformed");
    const chat = await newChat(tenant);
    const base = {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "ok" }],
      now: tick(),
    };
    const messageCount = async (): Promise<number> =>
      Number(
        (
          await db`SELECT COUNT(*) AS n FROM assistant_messages
            WHERE conversation_id = ${chat.conversation.id}`
        )[0]?.n,
      );
    await rejectsWithCode(
      appendMessage(db, { ...base, now: -1 }),
      "invalid-input",
    );
    await rejectsWithCode(
      appendMessage(db, { ...base, completedAt: -5 }),
      "invalid-input",
    );
    expect(await messageCount()).toBe(1);
    const started = await startRun(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
      messageId: chat.message.id,
      queryContextHash: "hash_malformed",
      model: "model-a",
      now: tick(),
    });
    if (!started.ok) throw new Error("expected run to start");
    await rejectsWithCode(
      finishRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        runId: started.run.id,
        status: "complete",
        latencyMs: -1,
        now: tick(),
      }),
      "invalid-input",
    );
    await rejectsWithCode(
      finishRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        runId: started.run.id,
        status: "complete",
        factIds: [""],
        now: tick(),
      }),
      "invalid-input",
    );
    // The run is still running: malformed finishes consume nothing.
    const fetched = await getConversation(db, {
      projectId: tenant.projectId,
      userId: tenant.userId,
      conversationId: chat.conversation.id,
    });
    expect(fetched?.activeRun?.status).toBe("running");
    await rejectsWithCode(
      startRun(db, {
        projectId: tenant.projectId,
        userId: tenant.userId,
        conversationId: chat.conversation.id,
        messageId: chat.message.id,
        queryContextHash: "hash_malformed2",
        model: "",
        now: tick(),
      }),
      "invalid-input",
    );
  });

  it("enforces durable checks below the store", async () => {
    // Raw SQL violating the contract-shaped CHECKs fails at the
    // database boundary even if a future caller bypasses validation.
    await expect(
      db`INSERT INTO assistant_messages
        (id, conversation_id, seq, role, status, parts, created_at, completed_at)
        VALUES ('msg_raw_bad', 'conv_missing', -1, 'system', 'complete', '[]', -5, NULL)`,
    ).rejects.toThrow();
  });
});

/**
 * R16 upgrade regression (Task 21 slice 4 follow-up).
 *
 * Applies the exact 0000–0007 migration files to a bare ephemeral
 * cluster, seeds a newly colliding confirmed pair plus a newly blank
 * legacy term, then applies the exact 0008 file inside ONE transaction
 * (mirroring the real drizzle runner, which wraps every pending file in
 * a single `session.transaction`). Asserts migration success, the
 * deterministic survivor, audit/history outcomes, and the final trigger,
 * CHECK, and exclusion invariants — plus a failure-atomicity negative
 * proving a reconciliation-less upgrade rolls back without a trace.
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
  confirmMemoryProposal,
  proposeMemory,
  readConfirmedKnowledge,
  readMemoryAudit,
  type AssistantDb,
} from "../utils/assistantStore";

const run = hasLocalPostgres() ? describe : describe.skip;

let pg: EphemeralPostgres | null = null;
let db: AssistantDb;

beforeAll(async () => {
  if (!hasLocalPostgres()) return;
  pg = await startEphemeralPostgres("assistant_r16_test");
  db = pg.sql as unknown as AssistantDb;
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

const NOW = 1_785_628_800_000;
let seq = 9000;
const tick = (): number => {
  seq += 1;
  return NOW + seq * 1000;
};

type Tenant = { userId: string; orgId: string; projectId: string };

async function newTenantOn(
  store: AssistantDb,
  tag: string,
): Promise<Tenant> {
  seq += 1;
  const userId = `u_${tag}_${seq}`;
  const orgId = `org_${tag}_${seq}`;
  await store`INSERT INTO "user" (id, name, email, email_verified)
    VALUES (${userId}, ${tag}, ${`${userId}@example.com`}, true)`;
  await store`INSERT INTO organization (id, name, slug, created_at)
    VALUES (${orgId}, ${tag}, ${`${orgId}-slug`}, ${new Date(NOW).toISOString()})`;
  await store`INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`m_${tag}_${seq}`}, ${orgId}, ${userId}, 'member', ${new Date(NOW).toISOString()})`;
  const rows = await store`INSERT INTO projects (creator_id, organization_id, name, slug)
    VALUES (${userId}, ${orgId}, ${tag}, ${`proj-${tag}-${seq}`}) RETURNING id`;
  return { userId, orgId, projectId: String(rows[0]?.id) };
}

async function migrationFile(folder: string, idx: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(folder)).filter(
    (name) => name.startsWith(idx) && name.endsWith(".sql"),
  );
  if (names.length !== 1) throw new Error(`expected one ${idx} file`);
  return path.join(folder, names[0] as string);
}

async function applyInTransaction(
  sql: EphemeralPostgres["sql"],
  filePath: string,
): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const statements = readFileSync(filePath, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
  });
}

run("R16-F1 colliding-upgrade healing", () => {
  it("heals newly colliding and newly blank legacy terms via the exact 0008 file", async () => {
    const bare = await startEphemeralPostgresBare("r16_heal");
    try {
      const folder = drizzleFolder();
      const { readFile, readdir } = await import("node:fs/promises");
      const { entries } = JSON.parse(
        await readFile(path.join(folder, "meta", "_journal.json"), "utf8"),
      ) as { entries: Array<{ tag: string }> };
      for (const entry of entries) {
        const idx = entry.tag.split("_")[0] as string;
        if ((idx as string) >= "0008") continue;
        for (const file of (await readdir(folder)).filter(
          (name) => name.startsWith(idx) && name.endsWith(".sql"),
        )) {
          await applyMigrationFile(bare.sql as never, path.join(folder, file));
        }
      }
      const store = bare.sql as unknown as AssistantDb;
      const tenant = await newTenantOn(store, "heal");
      const termValue = (name: string) => ({
        version: 1,
        label: name,
        description: `${name} term`,
        payload: { name, description: `${name} term` },
      });
      const propose = (name: string) =>
        proposeMemory(store, {
          organizationId: tenant.orgId,
          scope: "workspace",
          key: "business-term",
          value: termValue(name),
          proposerId: tenant.userId,
          authenticatedUserId: tenant.userId,
          now: tick(),
        });
      const confirm = (recordId: string) =>
        confirmMemoryProposal(store, {
          organizationId: tenant.orgId,
          recordId,
          confirmerId: tenant.userId,
          role: "owner",
          now: tick(),
          action: "confirm",
        });
      // Two terms distinct under the 0007 shorthand, one Policy v1 slot.
      const plain = await propose("A B");
      expect(await confirm(plain.id)).toMatchObject({ ok: true });
      const feff = await propose("A\uFEFFB");
      expect(await confirm(feff.id)).toMatchObject({ ok: true });
      // A legacy whitespace-only term, confirmable before 0008.
      const blank = await propose("   ");
      expect(await confirm(blank.id)).toMatchObject({ ok: true });
      // An unrelated term that must survive untouched.
      const other = await propose("NDR");
      expect(await confirm(other.id)).toMatchObject({ ok: true });

      // Exact 0008 file, one transaction like the real runner.
      await applyInTransaction(bare.sql, await migrationFile(folder, "0008"));

      // Deterministic winner: earliest created incumbent survives.
      const knowledge = await readConfirmedKnowledge(store, {
        organizationId: tenant.orgId,
        projectId: tenant.projectId,
        subjectUserId: tenant.userId,
      });
      expect(knowledge.workspace.map((entry) => entry.id).sort()).toEqual(
        [plain.id, other.id].sort(),
      );
      // Loser superseded with a migration-owned audit trail.
      const loserRows = (await store`SELECT status AS s FROM assistant_memory WHERE id = ${feff.id}`) as Array<{
        s: unknown;
      }>;
      expect(loserRows[0]?.s).toBe("superseded");
      const loserAudit = await readMemoryAudit(store, {
        organizationId: tenant.orgId,
        memoryId: feff.id,
      });
      expect(loserAudit?.map((entry) => entry.action)).toEqual([
        "proposed",
        "confirm",
        "superseded",
      ]);
      // Blank legacy term deleted with its audits (cascade).
      expect(
        (await store`SELECT id FROM assistant_memory WHERE id = ${blank.id}`) as Array<unknown>,
      ).toHaveLength(0);
      expect(
        await readMemoryAudit(store, {
          organizationId: tenant.orgId,
          memoryId: blank.id,
        }),
      ).toBeNull();
      // Final invariants: trigger on every update, CHECK + exclusion live,
      // stored slots equal the single function.
      const triggers = (await store`SELECT tgname AS n FROM pg_trigger WHERE tgname = 'assistant_memory_slot_term_trg' AND NOT tgisinternal`) as Array<{
        n: unknown;
      }>;
      expect(triggers.map((entry) => entry.n)).toContain(
        "assistant_memory_slot_term_trg",
      );
      const checks = (await store`SELECT conname AS n FROM pg_constraint WHERE conname = 'assistant_memory_slot_term_check'`) as Array<{
        n: unknown;
      }>;
      expect(checks.map((entry) => entry.n)).toContain(
        "assistant_memory_slot_term_check",
      );
      const exclusion = (await store`SELECT conname AS n FROM pg_constraint WHERE conname = 'assistant_memory_one_confirmed_per_slot'`) as Array<{
        n: unknown;
      }>;
      expect(exclusion.map((entry) => entry.n)).toContain(
        "assistant_memory_one_confirmed_per_slot",
      );
      const drift = (await store`SELECT COUNT(*) AS n FROM assistant_memory
        WHERE scope = 'workspace' AND "key" = 'business-term'
          AND slot_term <> assistant_canonical_term(payload ->> 'name')`) as Array<{
        n: unknown;
      }>;
      expect(Number(drift[0]?.n)).toBe(0);
      // Fresh writes keep working after the healed upgrade.
      const fresh = await propose("Acme Rate");
      expect(await confirm(fresh.id)).toMatchObject({ ok: true });
    } finally {
      await bare.stop();
    }
  });

  it("rolls back a reconciliation-less upgrade without a trace (atomicity)", async () => {
    const bare = await startEphemeralPostgresBare("r16_atomic");
    try {
      const folder = drizzleFolder();
      const { readFile, readdir } = await import("node:fs/promises");
      const { entries } = JSON.parse(
        await readFile(path.join(folder, "meta", "_journal.json"), "utf8"),
      ) as { entries: Array<{ tag: string }> };
      for (const entry of entries) {
        const idx = entry.tag.split("_")[0] as string;
        if ((idx as string) >= "0008") continue;
        for (const file of (await readdir(folder)).filter(
          (name) => name.startsWith(idx) && name.endsWith(".sql"),
        )) {
          await applyMigrationFile(bare.sql as never, path.join(folder, file));
        }
      }
      const store = bare.sql as unknown as AssistantDb;
      const tenant = await newTenantOn(store, "atomic");
      const termValue = (name: string) => ({
        version: 1,
        label: name,
        description: `${name} term`,
        payload: { name, description: `${name} term` },
      });
      for (const name of ["A B", "A\uFEFFB"]) {
        const proposal = await proposeMemory(store, {
          organizationId: tenant.orgId,
          scope: "workspace",
          key: "business-term",
          value: termValue(name),
          proposerId: tenant.userId,
          authenticatedUserId: tenant.userId,
          now: tick(),
        });
        expect(
          await confirmMemoryProposal(store, {
            organizationId: tenant.orgId,
            recordId: proposal.id,
            confirmerId: tenant.userId,
            role: "owner",
            now: tick(),
            action: "confirm",
          }),
        ).toMatchObject({ ok: true });
      }
      // Reconciliation-less attempt: new function + naive backfill inside
      // one transaction must fail with 23P01 and roll everything back.
      let failureCode: unknown;
      try {
        await bare.sql.begin(async (tx) => {
          await tx.unsafe(await functionStatement(folder, "0008"));
          await tx.unsafe(
            `UPDATE "assistant_memory" SET "slot_term" = CASE WHEN "key" = 'business-term' THEN COALESCE(assistant_canonical_term(payload ->> 'name'), '') ELSE '' END`,
          );
        });
      } catch (error) {
        failureCode = (error as { code?: unknown }).code;
      }
      expect(failureCode).toBe("23P01");
      // No partial upgrade: old function behavior intact, both terms still
      // confirmed, no new CHECK, old trigger shape retained.
      const probe = (await store`SELECT assistant_canonical_term(${ "A\uFEFFB"}) AS v`) as Array<{
        v: unknown;
      }>;
      expect(String(probe[0]?.v)).not.toBe("a b");
      const confirmed = (await store`SELECT COUNT(*) AS n FROM assistant_memory
        WHERE organization_id = ${tenant.orgId} AND status = 'confirmed'`) as Array<{
        n: unknown;
      }>;
      expect(Number(confirmed[0]?.n)).toBe(2);
      const checks = (await store`SELECT conname AS n FROM pg_constraint WHERE conname = 'assistant_memory_slot_term_check'`) as Array<{
        n: unknown;
      }>;
      expect(checks).toHaveLength(0);
    } finally {
      await bare.stop();
    }
  });
});

async function functionStatement(
  folder: string,
  idx: string,
): Promise<string> {
  const { readFile, readdir } = await import("node:fs/promises");
  const name = (await readdir(folder)).find(
    (entry) => entry.startsWith(idx) && entry.endsWith(".sql"),
  );
  const statements = (await readFile(path.join(folder, name as string), "utf8"))
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const fn = statements.find((stmt) =>
    stmt.includes("CREATE OR REPLACE FUNCTION assistant_canonical_term"),
  );
  if (!fn) throw new Error("function statement not found");
  return fn;
}

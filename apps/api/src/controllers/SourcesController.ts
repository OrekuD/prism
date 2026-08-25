import type { Context } from "hono";
import { z } from "zod";
import type { HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import { purgeSourceErrorData } from "../utils/analyticsErrorPurge";
import {
	executeMobilePurge,
	purgeMobileSourceStatements,
} from "../utils/mobilePurge";
import {
	readSourceErrorSettings,
	updateSourceErrorSettings,
	validateErrorSettingsPatch,
} from "../utils/sourceErrorSettings";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { OkResponse } from "../network/responses/OkResponse";
import { generateApiKey } from "../utils/generateApiKey";
import { getProjectRole, isAdminRole } from "../utils/workspaceAuth";
import { validateData } from "../utils/validateData";

/**
 * Task 13: source and source-key management behind project organization
 * authorization.
 *
 * - A source is one installation (web | ios | android | react-native |
 *   server). The platform is constrained to this fixed set — callers can
 *   never choose arbitrary capabilities or key visibility.
 * - Key visibility is derived from the platform: web/mobile sources get a
 *   PUBLISHABLE key (visible in client binaries, telemetry-write-only,
 *   origin-policed on web); server sources get a SECRET key (never leaves
 *   server-side configuration).
 * - Creating a source creates its initial key, returned RAW exactly once.
 *   Revoking or rotating a key never affects another source.
 * - Mutations (create/update/delete/rotate/revoke/reveal) need
 *   owner/admin; reads need any member. Non-members get non-disclosing
 *   404s.
 */

const PLATFORMS = ["web", "ios", "android", "react-native", "server"] as const;
const CREATABLE_PLATFORMS = ["web", "react-native", "server"] as const; // iOS/Android reserved, not advertised
type Platform = (typeof PLATFORMS)[number];

const PUBLISHABLE_PLATFORMS: ReadonlySet<string> = new Set([
  "web",
  "ios",
  "android",
  "react-native",
]);

const CreateSourceSchema = z.strictObject({
  name: z.string().min(1).max(80),
  platform: z.enum(CREATABLE_PLATFORMS as unknown as typeof PLATFORMS),
  // JSON array of allowed origins; only meaningful (and only accepted) for
  // web sources.
  allowedOrigins: z.array(z.string().url()).max(20).optional(),
});

const UpdateSourceSchema = z.strictObject({
  name: z.string().min(1).max(80).optional(),
  allowedOrigins: z.array(z.string().url()).max(20).optional(),
});

const CreateKeySchema = z.strictObject({
  name: z.string().min(1).max(80),
});

type SourceRow = {
  id: string;
  project_id: string;
  name: string;
  platform: string;
  allowed_origins: string | null;
};

type KeyRow = {
  id: string;
  source_id: string;
  name: string;
  key: string;
  key_type: string;
  status: string;
  last_used_at: string | null;
  created_at: string;
};

function maskSecretKey(key: string): string {
  // ssk_<64 hex> — keep the prefix + the last 4 characters.
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export class SourcesController {
  /** Resolves the project by slug and returns the caller's role, or null
   * (non-disclosing for both missing projects and non-members). */
  private static async projectForSlug(
    ctx: Context<HonoConfig>,
    slug: string,
  ): Promise<{ projectId: string; role: "owner" | "admin" | "member" } | null> {
    const user = ctx.get("user");
    if (!user) return null;
    const db = DatabaseManager.getInstance(ctx);
    const project = (
      (await db`SELECT id, organization_id FROM projects WHERE slug = ${slug} LIMIT 1`) as Array<{
        id: string;
        organization_id: string;
      }>
    )[0];
    if (!project) return null;
    const role = await getProjectRole(ctx, user.id, project.id);
    return role ? { projectId: project.id, role } : null;
  }

  private static async sourceForProject(
    ctx: Context<HonoConfig>,
    projectId: string,
    sourceId: string,
  ): Promise<SourceRow | null> {
    const rows = (await DatabaseManager.getInstance(ctx)`
      SELECT id, project_id, name, platform, allowed_origins
      FROM project_sources
      WHERE id = ${sourceId} AND project_id = ${projectId}
      LIMIT 1`) as Array<SourceRow>;
    return rows[0] ?? null;
  }

  private static async keysForSource(
    ctx: Context<HonoConfig>,
    sourceId: string,
  ): Promise<KeyRow[]> {
    return (await DatabaseManager.getInstance(ctx)`
      SELECT id, source_id, name, key, key_type, status, last_used_at, created_at
      FROM project_api_keys
      WHERE source_id = ${sourceId}
      ORDER BY created_at ASC`) as Array<KeyRow>;
  }

  /** Connection-state telemetry for one source (bounded aggregates). */
  private static async sourceTelemetry(
    ctx: Context<HonoConfig>,
    projectId: string,
    sourceId: string,
  ): Promise<{ events: number; lastReceivedAt: number | null }> {
    try {
      const rows = (await TursoDatabaseManager.getInstance(ctx).execute({
        sql: `SELECT COUNT(*) AS events, MAX(received_at) AS last_received
              FROM events
              WHERE project_id = ? AND source_id = ?`,
        args: [projectId, sourceId],
      })) as { rows: Array<{ events?: unknown; last_received?: unknown }> };
      const row = rows.rows[0];
      return {
        events: Number(row?.events ?? 0),
        lastReceivedAt:
          row?.last_received === null || row?.last_received === undefined
            ? null
            : Number(row.last_received),
      };
    } catch {
      // Telemetry is a connection-state nicety; it must never fail the
      // source listing.
      return { events: 0, lastReceivedAt: null };
    }
  }

  private static serializeSource(
    source: SourceRow,
    keys: KeyRow[],
    telemetry: { events: number; lastReceivedAt: number | null },
  ) {
    return {
      id: source.id,
      projectId: source.project_id,
      name: source.name,
      platform: source.platform,
      allowedOrigins: source.allowed_origins
        ? (JSON.parse(source.allowed_origins) as string[])
        : [],
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyType: key.key_type,
        status: key.status,
        lastUsedAt: key.last_used_at,
        createdAt: key.created_at,
        // Publishable keys are public by design (they live in client
        // binaries) and are returned in full for SDK snippets. Secret
        // keys are masked; reveal is a separate admin-only action.
        value:
          key.key_type === "publishable" ? key.key : maskSecretKey(key.key),
      })),
      telemetry,
    };
  }

  public static async list(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const db = DatabaseManager.getInstance(ctx);
    const sources = (await db`
      SELECT id, project_id, name, platform, allowed_origins
      FROM project_sources WHERE project_id = ${project.projectId}
      ORDER BY created_at ASC`) as Array<SourceRow>;

    const result = [];
    for (const source of sources) {
      const keys = await SourcesController.keysForSource(ctx, source.id);
      const telemetry = await SourcesController.sourceTelemetry(
        ctx,
        project.projectId,
        source.id,
      );
      result.push(SourcesController.serializeSource(source, keys, telemetry));
    }
    return ctx.json(result);
  }

  public static async detail(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }
    const keys = await SourcesController.keysForSource(ctx, source.id);
    const telemetry = await SourcesController.sourceTelemetry(
      ctx,
      project.projectId,
      source.id,
    );
    return ctx.json(SourcesController.serializeSource(source, keys, telemetry));
  }

  public static async create(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_create_source").toJSON(), 400);
    }

    const data = validateData(CreateSourceSchema, await ctx.req.json());
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    // Allowed origins are a WEB-only policy.
    if (data.platform !== "web" && (data.allowedOrigins?.length ?? 0) > 0) {
      return ctx.json(
        new ErrorResponse("allowed_origins_web_only").toJSON(),
        400,
      );
    }

    const db = DatabaseManager.getInstance(ctx);
    const source = (await db`
      INSERT INTO project_sources (project_id, name, platform, allowed_origins)
      VALUES (${project.projectId}, ${data.name}, ${data.platform},
              ${JSON.stringify(data.allowedOrigins ?? [])})
      RETURNING id`) as Array<{ id: string }>;
    if (source.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }

    // The initial key: key type derived from the platform, returned raw
    // EXACTLY once here.
    const keyType = PUBLISHABLE_PLATFORMS.has(data.platform)
      ? "publishable"
      : "secret";
    const key = generateApiKey(keyType);
    await db`INSERT INTO project_api_keys (source_id, name, key, key_type)
             VALUES (${source[0]?.id}, ${"Initial key"}, ${key}, ${keyType})`;

    const created = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      source[0]?.id ?? "",
    );
    if (!created) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }
    const keys = await SourcesController.keysForSource(ctx, created.id);
    const telemetry = await SourcesController.sourceTelemetry(
      ctx,
      project.projectId,
      created.id,
    );
    return ctx.json({
      ...SourcesController.serializeSource(created, keys, telemetry),
      // The initial secret is only ever in this response.
      initialKey: key,
    });
  }

  public static async update(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_update_source").toJSON(), 403);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }

    const data = validateData(UpdateSourceSchema, await ctx.req.json());
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    if (source.platform !== "web" && (data.allowedOrigins?.length ?? 0) > 0) {
      return ctx.json(
        new ErrorResponse("allowed_origins_web_only").toJSON(),
        400,
      );
    }

    const db = DatabaseManager.getInstance(ctx);
    await db`
      UPDATE project_sources
      SET name = ${data.name ?? source.name},
          allowed_origins = ${JSON.stringify(data.allowedOrigins ?? [])},
          updated_at = NOW()
      WHERE id = ${source.id}`;

    const keys = await SourcesController.keysForSource(ctx, source.id);
    const telemetry = await SourcesController.sourceTelemetry(
      ctx,
      project.projectId,
      source.id,
    );
    return ctx.json(
      SourcesController.serializeSource(
        {
          ...source,
          name: data.name ?? source.name,
          allowed_origins: JSON.stringify(data.allowedOrigins ?? []),
        },
        keys,
        telemetry,
      ),
    );
  }

  public static async remove(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_delete_source").toJSON(), 404);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }
    // Removing a source purges its error occurrences and any issues left
    // without occurrences (privacy default). Key REVOCATION does not purge —
    // previously accepted occurrences stay auditable, matching the issue
    // lifecycle rule that ignored/resolved data remains searchable.
    await purgeSourceErrorData(
      TursoDatabaseManager.getInstance(ctx),
      project.projectId,
      source.id,
    );
    // Task 18 (R3-F7): the source's mobile telemetry is purged in the SAME
    // privacy operation; aggregates with no remaining telemetry are removed.
    await executeMobilePurge(
      TursoDatabaseManager.getInstance(ctx),
      purgeMobileSourceStatements(project.projectId, source.id),
    );
    await DatabaseManager.getInstance(
      ctx,
    )`DELETE FROM project_sources WHERE id = ${source.id}`;
    return ctx.json(new OkResponse().toJSON());
  }

  /** Creates an ADDITIONAL key for safe rotation (multiple active keys are
   * allowed only for this purpose). Returns the raw key exactly once. */
  public static async createKey(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_create_key").toJSON(), 400);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }

    const data = validateData(CreateKeySchema, await ctx.req.json());
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const keyType = PUBLISHABLE_PLATFORMS.has(source.platform)
      ? "publishable"
      : "secret";
    const key = generateApiKey(keyType);
    await DatabaseManager.getInstance(ctx)`
      INSERT INTO project_api_keys (source_id, name, key, key_type)
      VALUES (${source.id}, ${data.name}, ${key}, ${keyType})`;

    return ctx.json({ id: undefined, name: data.name, keyType, value: key });
  }

  public static async revokeKey(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_revoke_key").toJSON(), 404);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }
    const updated = (await DatabaseManager.getInstance(ctx)`
      UPDATE project_api_keys SET status = 'revoked', updated_at = NOW()
      WHERE id = ${ctx.req.param("keyId") ?? ""} AND source_id = ${source.id}
      RETURNING id`) as Array<{ id: string }>;
    if (updated.length === 0) {
      return ctx.json(new ErrorResponse("key_not_found").toJSON(), 404);
    }
    return ctx.json(new OkResponse().toJSON());
  }

  /** Reveals a secret key to an owner/admin of the source's project. */
  public static async revealKey(ctx: Context<HonoConfig>) {
    const project = await SourcesController.projectForSlug(
      ctx,
      ctx.req.param("slug") ?? "",
    );
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(project.role)) {
      return ctx.json(new ErrorResponse("cannot_reveal_key").toJSON(), 404);
    }
    const source = await SourcesController.sourceForProject(
      ctx,
      project.projectId,
      ctx.req.param("sourceId") ?? "",
    );
    if (!source) {
      return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
    }
    const key = (
      (await DatabaseManager.getInstance(ctx)`
        SELECT key FROM project_api_keys
        WHERE id = ${ctx.req.param("keyId") ?? ""} AND source_id = ${source.id}
        LIMIT 1`) as Array<{ key: string }>
    )[0];
    if (!key) {
      return ctx.json(new ErrorResponse("key_not_found").toJSON(), 404);
    }
    return ctx.json({ value: key.key });
  }

	/**
	 * Per-source error collection configuration + live status (task-15 item
	 * 440). Member-readable. Defaults when no row exists; status always comes
	 * from the analytics store (never fabricated).
	 */
	public static async errorSettings(ctx: Context<HonoConfig>) {
		const project = await SourcesController.projectForSlug(
			ctx,
			ctx.req.param("slug") ?? "",
		);
		if (!project) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}
		const source = await SourcesController.sourceForProject(
			ctx,
			project.projectId,
			ctx.req.param("sourceId") ?? "",
		);
		if (!source) {
			return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
		}
		const settings = await readSourceErrorSettings(
			TursoDatabaseManager.getInstance(ctx),
			source.id,
		);
		return ctx.json(settings);
	}

	/**
	 * Update per-source error collection configuration (owner/admin only).
	 * Unknown/invalid fields reject the WHOLE patch with 400 — never a
	 * partial write, never a privacy-relevant silent default.
	 */
	public static async updateErrorSettings(ctx: Context<HonoConfig>) {
		const project = await SourcesController.projectForSlug(
			ctx,
			ctx.req.param("slug") ?? "",
		);
		if (!project) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}
		if (!isAdminRole(project.role)) {
			return ctx.json(new ErrorResponse("cannot_update_source").toJSON(), 403);
		}
		const source = await SourcesController.sourceForProject(
			ctx,
			project.projectId,
			ctx.req.param("sourceId") ?? "",
		);
		if (!source) {
			return ctx.json(new ErrorResponse("source_not_found").toJSON(), 404);
		}
		let body: unknown;
		try {
			body = await ctx.req.json();
		} catch {
			return ctx.json(new ErrorResponse("invalid_json").toJSON(), 400);
		}
		const patch = validateErrorSettingsPatch(body);
		if (!patch) {
			return ctx.json(
				new ErrorResponse("invalid_error_settings").toJSON(),
				400,
			);
		}
		const settings = await updateSourceErrorSettings(
			TursoDatabaseManager.getInstance(ctx),
			source.id,
			patch,
		);
		return ctx.json(settings);
	}

}

import type { ErrorAnalyticsClient } from "./errorIssuesStore";

/**
 * Per-source ERROR COLLECTION configuration (task-15 item 440) — the
 * dashboard intent for one source (the config the SDK setup snippet
 * reflects) plus a live collection status read from ingestion. The rows
 * live in the analytics store; the SDK always enforces its own explicit
 * opt-in, so these rows never change enforcement — only what the Sources
 * UI documents and shows as status.
 */

export type SourceErrorMode = "off" | "manual" | "all";

export type SourceErrorSettingsRow = {
	sourceId: string;
	mode: SourceErrorMode;
	captureGlobalErrors: boolean;
	breadcrumbsEnabled: boolean;
	samplingRate: number;
	release: string | null;
};

export type SourceErrorSettingsResource = SourceErrorSettingsRow & {
	/** Live collection status from the analytics store (30-day window). */
	lastSeenErrorAt: number | null;
	errorCount30d: number;
};

const DAY_MS = 86_400_000;

export const SOURCE_ERROR_SETTINGS_DEFAULTS: Omit<SourceErrorSettingsRow, "sourceId"> = {
	mode: "manual",
	captureGlobalErrors: false,
	breadcrumbsEnabled: false,
	samplingRate: 100,
	release: null,
};

/**
 * Validate a PATCH body. Returns a typed partial patch, or null when ANY
 * supplied field is invalid (a rejected 400, never a partial write).
 */
export function validateErrorSettingsPatch(
	raw: unknown,
): Partial<SourceErrorSettingsRow> | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const patch: Partial<SourceErrorSettingsRow> = {};
	if (value.mode !== undefined) {
		if (value.mode !== "off" && value.mode !== "manual" && value.mode !== "all") {
			return null;
		}
		patch.mode = value.mode;
	}
	if (value.captureGlobalErrors !== undefined) {
		if (typeof value.captureGlobalErrors !== "boolean") return null;
		patch.captureGlobalErrors = value.captureGlobalErrors;
	}
	if (value.breadcrumbsEnabled !== undefined) {
		if (typeof value.breadcrumbsEnabled !== "boolean") return null;
		patch.breadcrumbsEnabled = value.breadcrumbsEnabled;
	}
	if (value.samplingRate !== undefined) {
		const n = Number(value.samplingRate);
		if (!Number.isInteger(n) || n < 0 || n > 100) return null;
		patch.samplingRate = n;
	}
	if (value.release !== undefined) {
		if (value.release !== null && typeof value.release !== "string") {
			return null;
		}
		const trimmed =
			value.release === null ? null : String(value.release).trim();
		if (trimmed !== null && trimmed.length > 120) return null;
		patch.release = trimmed;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

async function readSettingsRow(
	client: ErrorAnalyticsClient,
	sourceId: string,
): Promise<Omit<SourceErrorSettingsRow, "sourceId"> | null> {
	const { rows } = await client.execute({
		sql: `SELECT mode, capture_global_errors, breadcrumbs_enabled,
            sampling_rate, release
          FROM source_error_settings
          WHERE source_id = ?`,
		args: [sourceId],
	});
	const row = rows[0] as
		| {
				mode?: unknown;
				capture_global_errors?: unknown;
				breadcrumbs_enabled?: unknown;
				sampling_rate?: unknown;
				release?: unknown;
		  }
		| undefined;
	if (!row) return null;
	return {
		mode: (row.mode as SourceErrorMode) ?? "manual",
		captureGlobalErrors: Number(row.capture_global_errors) === 1,
		breadcrumbsEnabled: Number(row.breadcrumbs_enabled) === 1,
		samplingRate: Number(row.sampling_rate ?? 100),
		release: row.release === null ? null : String(row.release),
	};
}

async function readStatus(
	client: ErrorAnalyticsClient,
	sourceId: string,
): Promise<{ lastSeenErrorAt: number | null; errorCount30d: number }> {
	const windowStart = Date.now() - 30 * DAY_MS;
	const { rows } = await client.execute({
		sql: `SELECT MAX(received_at) AS last_seen, COUNT(*) AS n
          FROM error_occurrences
          WHERE source_id = ? AND received_at >= ?`,
		args: [sourceId, windowStart],
	});
	const row = rows[0] as { last_seen?: unknown; n?: unknown } | undefined;
	return {
		lastSeenErrorAt: row?.last_seen ? Number(row.last_seen) : null,
		errorCount30d: Number(row?.n ?? 0),
	};
}

export async function readSourceErrorSettings(
	client: ErrorAnalyticsClient,
	sourceId: string,
): Promise<SourceErrorSettingsResource> {
	const [settings, status] = await Promise.all([
		readSettingsRow(client, sourceId),
		readStatus(client, sourceId),
	]);
	return {
		sourceId,
		...(settings ?? SOURCE_ERROR_SETTINGS_DEFAULTS),
		...status,
	};
}

export async function updateSourceErrorSettings(
	client: ErrorAnalyticsClient,
	sourceId: string,
	patch: Partial<SourceErrorSettingsRow>,
): Promise<SourceErrorSettingsResource> {
	const current = (await readSettingsRow(client, sourceId)) ??
		SOURCE_ERROR_SETTINGS_DEFAULTS;
	const next: Omit<SourceErrorSettingsRow, "sourceId"> = {
		mode: patch.mode ?? current.mode,
		captureGlobalErrors:
			patch.captureGlobalErrors ?? current.captureGlobalErrors,
		breadcrumbsEnabled:
			patch.breadcrumbsEnabled ?? current.breadcrumbsEnabled,
		samplingRate: patch.samplingRate ?? current.samplingRate,
		release: patch.release !== undefined ? patch.release : current.release,
	};
	await client.execute({
		sql: `INSERT INTO source_error_settings
            (source_id, mode, capture_global_errors, breadcrumbs_enabled,
             sampling_rate, release, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_id) DO UPDATE SET
            mode = excluded.mode,
            capture_global_errors = excluded.capture_global_errors,
            breadcrumbs_enabled = excluded.breadcrumbs_enabled,
            sampling_rate = excluded.sampling_rate,
            release = excluded.release,
            updated_at = excluded.updated_at`,
		args: [
			sourceId,
			next.mode,
			next.captureGlobalErrors ? 1 : 0,
			next.breadcrumbsEnabled ? 1 : 0,
			next.samplingRate,
			next.release,
			Date.now(),
		],
	});
	return readSourceErrorSettings(client, sourceId);
}

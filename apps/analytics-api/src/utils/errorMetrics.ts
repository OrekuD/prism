/**
 * Task-15 slice 4: coarse operational metrics for error tracking.
 *
 * These counters are the ONLY numbers Prism keeps for error ingestion —
 * they never carry exception text, keys, session ids, or any field that
 * could reconstruct a payload. A mismatch count is just a number. The
 * full set (from task-15 "operational checklist") is: accepted / rejected
 * / rate-limited reports, queue delay, grouping latency, database failure,
 * source-map processing status, storage volume, and retention deletions.
 *
 * Queue delay + grouping latency are timing gauges recorded around the
 * ingestion pipeline; source-map processing is always idle until that
 * phase starts; storage volume is computed from the store, not counters.
 */

export interface ErrorMetricSnapshot {
	accepted: number;
	rejected: number;
	rateLimited: number;
	duplicates: number;
	oversize: number;
	invalidEnvelope: number;
	dbFailures: number;
	/** Latest grouping latency in ms (0 when none recorded yet). */
	lastGroupingLatencyMs: number;
	/** Most recent observed ingest latency in ms. */
	lastIngestLatencyMs: number;
	/** Retention deletions since process start. */
	retentionDeletedOccurrences: number;
	retentionDeletedIssues: number;
}

const zero = (): ErrorMetricSnapshot => ({
	accepted: 0,
	rejected: 0,
	rateLimited: 0,
	duplicates: 0,
	oversize: 0,
	invalidEnvelope: 0,
	dbFailures: 0,
	lastGroupingLatencyMs: 0,
	lastIngestLatencyMs: 0,
	retentionDeletedOccurrences: 0,
	retentionDeletedIssues: 0,
});

/**
 * Mutable module-scoped singleton. Latency gauges are assigned (not
 * summed); counting metrics accumulate.
 */
class ErrorMetricsRegistry {
	private counters: ErrorMetricSnapshot = zero();

	record(partial: Partial<ErrorMetricSnapshot>): void {
		for (const key of Object.keys(partial) as Array<keyof ErrorMetricSnapshot>) {
			const value = partial[key];
			if (typeof value !== "number" || !Number.isFinite(value)) continue;
			if (key.startsWith("last")) {
				// Gauge: latest observed value replaces the previous one.
				(this.counters as unknown as Record<string, number>)[key] = value;
			} else {
				(this.counters as unknown as Record<string, number>)[key] =
					(this.counters as unknown as Record<string, number>)[key] + value;
			}
		}
	}

	snapshot(): ErrorMetricSnapshot {
		return { ...this.counters };
	}

	reset(): void {
		this.counters = zero();
	}

	/** Prometheus-style exposition of the coarse counters (never payloads). */
	renderPrometheus(): string {
		const s = this.snapshot();
		return [
			"# HELP prism_errors_ingested_total Accepted non-duplicate error items.",
			`prism_errors_ingested_total ${s.accepted}`,
			"# HELP prism_errors_rejected_total Rejected error items.",
			`prism_errors_rejected_total ${s.rejected}`,
			"# HELP prism_errors_rate_limited_total Quota-rejected batches.",
			`prism_errors_rate_limited_total ${s.rateLimited}`,
			"# HELP prism_errors_duplicate_total Idempotent retried client ids.",
			`prism_errors_duplicate_total ${s.duplicates}`,
			"# HELP prism_errors_oversize_total Oversized batches (413).",
			`prism_errors_oversize_total ${s.oversize}`,
			"# HELP prism_errors_db_failures_total Persist failures.",
			`prism_errors_db_failures_total ${s.dbFailures}`,
			"# HELP prism_errors_retention_deletions_total Occurrences pruned by retention.",
			`prism_errors_retention_deletions_total ${s.retentionDeletedOccurrences}`,
		].join("\n") + "\n";
	}
}

export const errorMetrics = new ErrorMetricsRegistry();

/**
 * Storage volume for error data (counts + total payload bytes). Quantity
 * only — payload bytes are a summed length, never sampled contents.
 */
export async function errorStorageVolume(execute: {
	(input: {
		sql: string;
		args: Array<string | number | null>;
	}): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<{
	issues: number;
	occurrences: number;
	occurrencePayloadBytes: number;
	issueUsers: number;
	activityRows: number;
}> {
	const count = async (
		sql: string,
		args: Array<string | number | null> = [],
	): Promise<number> => {
		const { rows } = await execute({ sql, args });
		return Number(rows[0]?.n ?? 0);
	};
	const [issues, occurrences, payloadBytes, issueUsers, activityRows] =
		await Promise.all([
			count("SELECT COUNT(*) AS n FROM error_issues"),
			count("SELECT COUNT(*) AS n FROM error_occurrences"),
			count(
				"SELECT COALESCE(SUM(LENGTH(payload)), 0) AS n FROM error_occurrences",
			),
			count("SELECT COUNT(*) AS n FROM error_issue_users"),
			count("SELECT COUNT(*) AS n FROM error_issue_activity"),
		]);
	return {
		issues,
		occurrences,
		occurrencePayloadBytes: payloadBytes,
		issueUsers,
		activityRows,
	};
}

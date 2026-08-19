import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorMetrics, errorStorageVolume } from "../utils/errorMetrics.js";

describe("errorMetrics", () => {
	beforeEach(() => {
		errorMetrics.reset();
	});

	it("accumulates counters and replaces latency gauges", () => {
		errorMetrics.record({ accepted: 3, rejected: 2, rateLimited: 1 });
		errorMetrics.record({ accepted: 7 });
		const s = errorMetrics.snapshot();
		expect(s.accepted).toBe(10);
		expect(s.rejected).toBe(2);
		expect(s.rateLimited).toBe(1);

		errorMetrics.record({ lastIngestLatencyMs: 12 });
		errorMetrics.record({ lastIngestLatencyMs: 40 });
		expect(errorMetrics.snapshot().lastIngestLatencyMs).toBe(40);
	});

	it("renders coarse Prometheus text that never leaks payload content", () => {
		errorMetrics.record({ accepted: 5, dbFailures: 1 });
		const text = errorMetrics.renderPrometheus();
		expect(text).toContain("prism_errors_ingested_total 5");
		expect(text).toContain("prism_errors_db_failures_total 1");
		expect(text).not.toMatch(/secret|password|token/i);
	});

	it("pushes invalid records through without corrupting counters", () => {
		errorMetrics.record({ accepted: Number.NaN } as never);
		errorMetrics.record({ accepted: 2 });
		expect(errorMetrics.snapshot().accepted).toBe(2);
	});
});

describe("errorStorageVolume", () => {
	it("reports quantity-only volume from the store", async () => {
		const execute = vi.fn(async (input: { sql: string }) => {
			const sql = input.sql;
			if (sql.includes("SUM(LENGTH(payload))")) return { rows: [{ n: 1234 }] };
			if (sql.includes("FROM error_issues")) return { rows: [{ n: 3 }] };
			if (sql.includes("FROM error_occurrences")) return { rows: [{ n: 40 }] };
			if (sql.includes("FROM error_issue_users")) return { rows: [{ n: 12 }] };
			if (sql.includes("FROM error_issue_activity"))
				return { rows: [{ n: 5 }] };
			return { rows: [{ n: 0 }] };
		});
		const volume = await errorStorageVolume(execute as never);
		expect(volume.issues).toBe(3);
		expect(volume.occurrences).toBe(40);
		expect(volume.occurrencePayloadBytes).toBe(1234);
		expect(volume.issueUsers).toBe(12);
		expect(volume.activityRows).toBe(5);
	});
});

/**
 * Database integration tests for the error ingestion path (task-15
 * slice 1).
 *
 * OPT-IN: these tests hit the real Turso database and are SKIPPED unless
 * PRISM_RUN_INTEGRATION=1 (with TURSO_DATABASE_URL/TURSO_AUTH_TOKEN
 * pointing at an ISOLATED analytics test database). They never run
 * against the shared development database by default.
 *
 *   PRISM_RUN_INTEGRATION=1 yarn workspace prism-analytics-api test
 *
 * Rows created by this suite are deleted at the end of each test.
 */
import "./../testEnv.js";
import { createClient } from "@libsql/client";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { ErrorIngestController } from "../../controllers/ErrorIngestController.js";

config({ path: ".env" });

const enabled =
	process.env.PRISM_RUN_INTEGRATION === "1" && !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

const PROJECT_ID = "itest-err-project-0000-0000-0000-000000000001";
const OTHER_PROJECT = "itest-err-other-0000-0000-0000-000000000002";

function streamOf(body: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

function makeCtx(body: string, projectId = PROJECT_ID) {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === "content-type"
					? "application/json"
					: String(body.length),
			raw: { body: streamOf(body) },
		},
		header: () => undefined,
		json: (value: unknown, status?: number) => ({ __json: value, status }),
		get: (name: string) =>
			({
				projectId,
				sourceId: "itest-err-source-0000-0000-0000-000000000001",
				platform: "web",
				keyType: "publishable",
			})[name] ?? "",
	} as never;
}

run("error ingestion database integration", () => {
	it("groups occurrences into issues, reopens on new occurrence, and dedupes retries", async () => {
		if (!enabled) return;
		const client = createClient({
			url: process.env.TURSO_DATABASE_URL ?? "",
			authToken: process.env.TURSO_AUTH_TOKEN ?? "",
		});

		const cleanup = async () => {
			await client.execute({
				sql: `DELETE FROM error_occurrences WHERE project_id IN (?, ?)`,
				args: [PROJECT_ID, OTHER_PROJECT],
			});
			await client.execute({
				sql: `DELETE FROM error_issues WHERE project_id IN (?, ?)`,
				args: [PROJECT_ID, OTHER_PROJECT],
			});
			await client.execute({
				sql: `DELETE FROM error_issue_users WHERE issue_id NOT IN (
          SELECT id FROM error_issues)`,
				args: [],
			});
			client.close();
		};

		try {
			const occurredAt = Date.now();
			const body = (id: string, message: string, anonymousId: string) =>
				JSON.stringify({
					schemaVersion: 1,
					sentAt: Date.now(),
					sdk: { name: "@prism-analytics/browser", version: "0.1.0" },
					errors: [
						{
							id,
							occurredAt,
							level: "error",
							handled: false,
							exception: {
								type: "TypeError",
								message,
								frames: [
									{
										file: "https://itest.app/app.js",
										function: "renderList",
										line: 203,
									},
								],
							},
							release: "web@itest",
							environment: "production",
							anonymousId,
						},
					],
				});

			// 1) two occurrences of the SAME error group into one issue
			const first = (await ErrorIngestController.ingest(
				makeCtx(body("evt-a", "boom 123", "anon-1")),
			)) as unknown as { __json: { results: Array<{ status: string }> } };
			expect(first.__json.results[0]?.status).toBe("accepted");

			const second = (await ErrorIngestController.ingest(
				makeCtx(body("evt-b", "boom 456", "anon-1")),
			)) as unknown as { __json: { results: Array<{ status: string }> } };
			expect(second.__json.results[0]?.status).toBe("accepted");

			const issues = await client.execute({
				sql: "SELECT id, occurrence_count, users_affected, status, title FROM error_issues WHERE project_id = ?",
				args: [PROJECT_ID],
			});
			expect(issues.rows).toHaveLength(1);
			const issue = issues.rows[0] as unknown as {
				occurrence_count: number;
				users_affected: number;
				title: string;
			};
			// digit runs normalized -> both messages group; count = 2, one user
			expect(issue.occurrence_count).toBe(2);
			expect(issue.users_affected).toBe(1);

			// 2) a retry of an already-stored client event id is a duplicate:
			// no new occurrence, no count bump
			const retry = (await ErrorIngestController.ingest(
				makeCtx(body("evt-a", "boom 123", "anon-1")),
			)) as unknown as { __json: { results: Array<{ duplicate?: boolean }> } };
			expect(retry.__json.results[0]?.duplicate).toBe(true);

			const afterRetry = await client.execute({
				sql: "SELECT occurrence_count FROM error_issues WHERE project_id = ?",
				args: [PROJECT_ID],
			});
			expect(
				(afterRetry.rows[0] as unknown as { occurrence_count: number })
					.occurrence_count,
			).toBe(2);

			// 3) a NEW fingerprint creates a second issue
			await ErrorIngestController.ingest(
				makeCtx(
					JSON.stringify({
						schemaVersion: 1,
						errors: [
							{
								id: "evt-c",
								occurredAt,
								level: "warning",
								handled: true,
								exception: {
									type: "RangeError",
									message: "different error",
									frames: [
										{
											file: "https://itest.app/lib/tree.ts",
											function: "walk",
											line: 203,
										},
									],
								},
							},
						],
					}),
				),
			);
			const afterNew = await client.execute({
				sql: "SELECT title, occurrence_count FROM error_issues WHERE project_id = ? ORDER BY first_seen_at",
				args: [PROJECT_ID],
			});
			expect(afterNew.rows).toHaveLength(2);

			// 4) resolving then a new occurrence reopens the issue
			await client.execute({
				sql: "UPDATE error_issues SET status = 'resolved', resolved_at = ? WHERE project_id = ?",
				args: [occurredAt, PROJECT_ID],
			});
			await ErrorIngestController.ingest(
				makeCtx(body("evt-d", "boom 789", "anon-2")),
			);
			const reopened = await client.execute({
				sql: "SELECT status FROM error_issues WHERE project_id = ? AND title = ?",
				args: [PROJECT_ID, "TypeError: boom 789"],
			});
			expect((reopened.rows[0] as unknown as { status: string }).status).toBe(
				"unresolved",
			);
		} finally {
			await cleanup();
		}
	});
});

import { describe, expect, it } from "vitest";
import { loadWebAnalytics } from "../utils/webAnalyticsLoader";
import type {
	WebAnalyticsExecuteClient,
	WebAnalyticsQueryParams,
} from "../utils/webAnalyticsStore";

describe("web analytics loader", () => {
	it("executes the fixed read-model queries sequentially", async () => {
		let activeQueries = 0;
		let maximumActiveQueries = 0;
		const statements: string[] = [];
		const client: WebAnalyticsExecuteClient = {
			execute: async ({ sql }) => {
				activeQueries += 1;
				maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
				statements.push(sql);

				await Promise.resolve();

				activeQueries -= 1;
				return { rows: [] };
			},
		};
		const params: WebAnalyticsQueryParams = {
			projectId: "project-1",
			from: 1_785_542_400_000,
			to: 1_785_628_800_000,
			sourceIds: [],
			host: null,
			path: null,
			traffic: "human",
		};

		await loadWebAnalytics(params, params.to, client);

		expect(statements).toHaveLength(13);
		expect(maximumActiveQueries).toBe(1);
	});
});

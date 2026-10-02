import { createClient, type Client } from "@libsql/client";
import {
  ProjectOverviewResourceSchema,
  type ProjectCapabilities,
} from "@prism-analytics/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import { loadMobileAnalytics } from "../utils/mobileAnalyticsLoader";
import { buildOverviewResource } from "../utils/projectOverview";
import type { CanonicalClient } from "../utils/projectMetrics";

const FROM = 1_785_542_400_000;
const TO = FROM + 86_400_000;
const params = {
  projectId: "coverage-project",
  from: FROM,
  to: TO,
  asOf: TO,
  sourceIds: ["mobile-source"],
  os: null,
  release: null,
};
let client: Client;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  await applyPendingMigrations(client, readMigrationFiles());
  // Two screens belong to a session started before the requested window.
  // The one session started inside it has no technology/geography data.
  await client.execute({
    sql: `INSERT INTO mobile_app_sessions
      (project_id, session_id, source_id, started_at, last_active_at, screen_count)
      VALUES (?, 'old', 'mobile-source', ?, ?, 2),
             (?, 'new', 'mobile-source', ?, ?, 1)`,
    args: [
      params.projectId,
      FROM - 1,
      FROM + 2,
      params.projectId,
      FROM + 1,
      FROM + 3,
    ],
  });
  const rows = [
    {
      id: "one",
      session: "old",
      os: "ios",
      country: "US",
      source: "mobile-source",
      received: FROM + 1,
      occurred: FROM + 1,
    },
    {
      id: "two",
      session: "old",
      os: "ios",
      country: "FR",
      source: "mobile-source",
      received: FROM + 2,
      occurred: FROM + 2,
    },
    {
      id: "three",
      session: "new",
      os: null,
      country: null,
      source: "mobile-source",
      received: FROM + 3,
      occurred: FROM + 3,
    },
    {
      id: "late",
      session: "late",
      os: "android",
      country: "GB",
      source: "mobile-source",
      received: TO + 1,
      occurred: FROM + 4,
    },
    {
      id: "other",
      session: "other",
      os: "android",
      country: "GB",
      source: "other-source",
      received: FROM + 4,
      occurred: FROM + 4,
    },
    {
      id: "boundary",
      session: "boundary",
      os: "android",
      country: "GB",
      source: "mobile-source",
      received: TO,
      occurred: TO,
    },
  ];
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, session_id, properties, source_id, platform)
        VALUES (?, ?, 'track', '$prism_screen_view', 1, ?, ?, ?, '{}', ?, 'react-native')`,
      args: [
        row.id,
        params.projectId,
        row.occurred,
        row.received,
        row.session,
        row.source,
      ],
    });
    await client.execute({
      sql: `INSERT INTO mobile_screen_views (project_id, event_id, occurred_at, session_id, session_sequence, screen_name, navigation, source_id, os, country_code, app_version)
        VALUES (?, ?, ?, ?, 1, 'Home', 'initial', ?, ?, ?, '1.0')`,
      args: [
        params.projectId,
        row.id,
        row.occurred,
        row.session,
        row.source,
        row.os,
        row.country,
      ],
    });
  }
});
afterAll(() => client.close());

describe("mobile enrichment coverage", () => {
  it("uses the filtered screen cohort, excludes unknown OS, and counts located sessions once", async () => {
    const { resource } = await loadMobileAnalytics(client, params);
    expect(resource.totals.appSessions).toBe(1);
    expect(resource.coverage).toEqual({
      technologyPercent: 66.7,
      geographyPercent: 50,
    });
    expect(resource.technology.coveragePercent).toBe(66.7);
    expect(resource.locations.coveragePercent).toBe(50);
    const ios = await loadMobileAnalytics(client, {
      ...params,
      os: "ios",
      release: "1.0",
    });
    expect(ios.resource.coverage).toEqual({
      technologyPercent: 100,
      geographyPercent: 100,
    });
    const empty = await loadMobileAnalytics(client, {
      ...params,
      os: "android",
    });
    expect(empty.resource.coverage).toEqual({
      technologyPercent: 0,
      geographyPercent: 0,
    });
  });

  it("returns a schema-valid overview with the same coverage on its mobile facts", async () => {
    const capabilities: ProjectCapabilities = {
      web: false,
      mobile: true,
      server: false,
      errorCollection: { configured: false, observed: false },
      standardEventsObserved: [],
      sources: { total: 2, active: 2, lastReceivedAt: TO },
      trafficPolicy: "human",
    };
    const resource = await buildOverviewResource({
      client: client as unknown as CanonicalClient,
      projectId: params.projectId,
      window: {
        from: FROM,
        to: TO,
        compareFrom: FROM - (TO - FROM),
        compareTo: FROM,
        asOf: TO,
      },
      scope: { sourceScope: "selected", sourceIds: params.sourceIds },
      capabilities,
      deps: { capabilities, now: TO },
    });
    expect(
      ProjectOverviewResourceSchema.safeParse({
        ...resource,
        queryContextToken: "x".repeat(16),
      }).success,
    ).toBe(true);
    const mobile = [...resource.pulse, ...resource.supportingFacts].find(
      (fact) => fact.metricId === "mobile.app_opens",
    );
    expect(mobile?.coverage.enrichments).toEqual([
      { dimension: "technology", coveragePercent: 66.7 },
      { dimension: "geography", coveragePercent: 50 },
    ]);
  });
});

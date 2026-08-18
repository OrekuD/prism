import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/authClient";
import { axiosInstance } from "@/utils/axiosInstance";
import type { TotalsResource } from "@prism-analytics/types";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { IconFolder, IconGlobe, IconDoc } from "@/components/layout/v2/icons";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";

const INITIALIZE = `const prism = await createBrowserClient({
  sourceKey: "psk_…",
  endpoint: "${typeof window !== "undefined" ? window.location.origin : "http://localhost"}",
  collection: { initialState: "granted" },
});`;

/** Honest workspace totals: sum of the per-project totals API. */
function useWorkspaceTotals(projects?: Array<{ slug: string }>) {
  return useQuery({
    queryKey: ["workspace-totals", (projects ?? []).map((p) => p.slug)],
    queryFn: async () => {
      const list = await Promise.all(
        (projects ?? []).map((p) =>
          axiosInstance.get<TotalsResource>(`/projects/${p.slug}/totals`),
        ),
      );
      return (list.map((r) => r.data) as TotalsResource[]).reduce(
        (acc, t) => ({
          events: acc.events + t.events,
          sessions: acc.sessions + t.sessions,
          people: acc.people + t.people,
          anonymousIdentities: acc.anonymousIdentities + t.anonymousIdentities,
        }),
        { events: 0, sessions: 0, people: 0, anonymousIdentities: 0 },
      );
    },
    enabled: Boolean(projects && projects.length > 0),
  });
}

/** Sum the daily session counts across projects, ordered by date (real
 * sparkline series for the Sessions metric). */
function useSessionSeries(projects?: Array<{ summary?: Array<{ date: string; desktop: number; mobile: number }> }>) {
  return React.useMemo(() => {
    const byDate = new Map<string, number>();
    for (const project of projects ?? []) {
      for (const row of project.summary ?? []) {
        byDate.set(
          row.date,
          (byDate.get(row.date) ?? 0) + row.desktop + row.mobile,
        );
      }
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => value);
  }, [projects]);
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <svg className="sparkline" viewBox="0 0 100 25" preserveAspectRatio="none" aria-hidden="true" data-empty />
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${((index / (values.length - 1)) * 100).toFixed(1)},${(
          24 -
          ((value - min) / range) * 21 -
          1
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 100 25" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--accent)" />
    </svg>
  );
}

function UsageMetric({
  label,
  value,
  caption,
  series,
  loading,
}: {
  label: string;
  value: number;
  caption: string;
  series: number[];
  loading: boolean;
}) {
  return (
    <div className="frame metric mk">
      <div className="frame-label">{label}</div>
      <div className="metric-top">
        {loading ? (
          <span className="skel skel-v" />
        ) : (
          <span className="metric-value num">{value.toLocaleString()}</span>
        )}
      </div>
      <span className="metric-caption">{caption}</span>
      {loading ? <span className="skel" /> : <Sparkline values={series} />}
    </div>
  );
}

/**
 * Workspace overview (v2 dashboard): welcome heading, honest usage summary
 * (aggregated workspace totals + real daily session sparkline), quick
 * links, and the Get-started install/init/verify panel.
 */
export function Overview() {
  const { data: sessionData } = authClient.useSession();
  const { data: projects, isLoading } = useProjectsQuery();
  const totalsQuery = useWorkspaceTotals(projects);
  const sessionSeries = useSessionSeries(projects);

  const firstName = sessionData?.user?.name?.split(/\s+/)[0] ?? "";

  return (
    <>
      <h1 className="page-title">
        <span className="tt-prefix">{"//"}</span>Welcome back, {firstName || "there"}
      </h1>
      <p className="page-sub">Overview of your Prism workspace.</p>

      <div className="sec-label">Usage summary</div>
      <div className="grid3">
        <UsageMetric
          label="Visitors"
          value={totalsQuery.data?.people ?? 0}
          caption="Known people"
          series={[]}
          loading={isLoading || totalsQuery.isFetching}
        />
        <UsageMetric
          label="Sessions"
          value={totalsQuery.data?.sessions ?? 0}
          caption="Distinct sessions"
          series={sessionSeries}
          loading={isLoading || totalsQuery.isFetching}
        />
        <UsageMetric
          label="Events"
          value={totalsQuery.data?.events ?? 0}
          caption="Logged events"
          series={[]}
          loading={isLoading || totalsQuery.isFetching}
        />
      </div>

      <div className="sec-label">Quick links</div>
      <div className="grid3">
        <Link className="frame qlink mk" to="/projects">
          <span className="iw"><IconFolder /></span>
          <h3>Projects</h3>
          <p>Manage tracked applications.</p>
          <span className="go">Open projects <Go /></span>
        </Link>
        <Link className="frame qlink mk" to="/projects">
          <span className="iw"><IconGlobe /></span>
          <h3>Sources</h3>
          <p>Set up SDKs and manage keys per source.</p>
          <span className="go">Open sources <Go /></span>
        </Link>
        <a className="frame qlink mk" href={VITE_DOCS_URL} target="_blank" rel="noreferrer">
          <span className="iw"><IconDoc /></span>
          <h3>Documentation</h3>
          <p>Install and use the Prism SDK.</p>
          <span className="go">Read the docs <Go /></span>
        </a>
      </div>

      <div className="sec-label"><span className="tt-prefix">{"//"}</span>Get started</div>
      <div className="frame setup mk">
        <div className="setup-head">
          <div>
            <h3>Connect your first project</h3>
            <p>Add the Prism SDK and verify the first event. Events appear in your workspace within seconds.</p>
          </div>
          <a
            className="btn btn-secondary btn-sm"
            href={VITE_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            View docs
          </a>
        </div>
        <div className="steps">
          <div className="step">
            <span className="st-num">01</span>
            <div>
              <div className="st-label">Install</div>
              <CodeCopyRow command="yarn add @prism-analytics/core" />
            </div>
          </div>
          <div className="step">
            <span className="st-num">02</span>
            <div>
              <div className="st-label">Initialize</div>
              <CodeCopyRow command={INITIALIZE} prompt="$" />
            </div>
          </div>
          <div className="step">
            <span className="st-num">03</span>
            <div>
              <div className="st-label">Verify</div>
              <div className="st-verify">
                <span className="pulse" aria-hidden="true" />
                <span className="vt">Waiting for the first event</span>
                <span className="vs">Listening</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Go() {
  return (
    <svg style={{ width: 11, height: 11 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

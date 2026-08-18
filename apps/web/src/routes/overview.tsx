import React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/authClient";
import { axiosInstance } from "@/utils/axiosInstance";
import type { TotalsResource } from "@prism-analytics/types";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { Frame } from "@/components/public/frame";
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
    return <svg className="mt-2 block h-[25px] w-full" viewBox="0 0 100 25" preserveAspectRatio="none" aria-hidden="true" />;
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
    <svg className="mt-2 block h-[25px] w-full" viewBox="0 0 100 25" preserveAspectRatio="none" aria-hidden="true">
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
    <Frame className="flex min-h-[122px] flex-col p-4 pb-3" label={label}>
      <div className="flex items-center justify-between gap-2">
        {loading ? (
          <span className="h-[26px] w-[110px] animate-pulse rounded-[2px] bg-surface-raised" />
        ) : (
          <span className="font-mono text-[23px] tracking-[-0.06em] text-text tabular-nums whitespace-nowrap">
            {value.toLocaleString()}
          </span>
        )}
      </div>
      <span className="mt-1.5 text-[10px] text-text-muted">{caption}</span>
      {loading ? (
        <span className="mt-2 block h-[25px] w-[72px] animate-pulse rounded-[2px] bg-surface-raised" />
      ) : (
        <Sparkline values={series} />
      )}
    </Frame>
  );
}

export function Overview() {
  const { wrkSlug } = useParams<{ wrkSlug: string }>();
  const { data: sessionData } = authClient.useSession();
  const { data: projects, isLoading } = useProjectsQuery();
  const totalsQuery = useWorkspaceTotals(projects);
  const sessionSeries = useSessionSeries(projects);

  const firstName = sessionData?.user?.name?.split(/\s+/)[0] ?? "";

  return (
    <>
      <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
        <span className="mr-2.5 select-none text-text-subtle">{"//"}</span>Welcome back,{" "}
        {firstName || "there"}
      </h1>
      <p className="mt-2 text-sm text-text-muted">Overview of your Prism workspace.</p>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
        Usage summary
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UsageMetric label="Visitors" value={totalsQuery.data?.people ?? 0} caption="Known people" series={[]} loading={isLoading || totalsQuery.isFetching} />
        <UsageMetric label="Sessions" value={totalsQuery.data?.sessions ?? 0} caption="Distinct sessions" series={sessionSeries} loading={isLoading || totalsQuery.isFetching} />
        <UsageMetric label="Events" value={totalsQuery.data?.events ?? 0} caption="Logged events" series={[]} loading={isLoading || totalsQuery.isFetching} />
      </div>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
        Quick links
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Frame className="flex min-h-[128px] flex-col gap-3.5 p-5 transition-colors hover:bg-surface-hover hover:border-border-strong">
          <Link to={`/${wrkSlug}/projects`} className="flex h-full flex-col gap-3.5">
            <span className="grid size-9 place-items-center rounded-[2px] border border-border bg-surface-raised"><IconFolder /></span>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Projects</h3>
            <p className="max-w-[36ch] text-[13px] leading-relaxed text-text-muted">Manage tracked applications.</p>
            <span className="mt-auto flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-link">Open projects <Go /></span>
          </Link>
        </Frame>
        <Frame className="flex min-h-[128px] flex-col gap-3.5 p-5 transition-colors hover:bg-surface-hover hover:border-border-strong">
          <Link to={`/${wrkSlug}/projects`} className="flex h-full flex-col gap-3.5">
            <span className="grid size-9 place-items-center rounded-[2px] border border-border bg-surface-raised"><IconGlobe /></span>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Sources</h3>
            <p className="max-w-[36ch] text-[13px] leading-relaxed text-text-muted">Set up SDKs and manage keys per source.</p>
            <span className="mt-auto flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-link">Open sources <Go /></span>
          </Link>
        </Frame>
        <Frame className="flex min-h-[128px] flex-col gap-3.5 p-5 transition-colors hover:bg-surface-hover hover:border-border-strong">
          <a href={VITE_DOCS_URL} target="_blank" rel="noreferrer" className="flex h-full flex-col gap-3.5">
            <span className="grid size-9 place-items-center rounded-[2px] border border-border bg-surface-raised"><IconDoc /></span>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Documentation</h3>
            <p className="max-w-[36ch] text-[13px] leading-relaxed text-text-muted">Install and use the Prism SDK.</p>
            <span className="mt-auto flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-link">Read the docs <Go /></span>
          </a>
        </Frame>
      </div>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
        <span className="mr-1 text-text-subtle">{"//"}</span>Get started
      </div>
      <Frame className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Connect your first project</h3>
            <p className="mt-1.5 text-[13px] text-text-muted">Add the Prism SDK and verify the first event. Events appear in your workspace within seconds.</p>
          </div>
          <a href={VITE_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-[2px] border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover">
            View docs
          </a>
        </div>
        <div className="mt-6 flex flex-col gap-[18px]">
          <div className="grid grid-cols-[32px_1fr] gap-2.5">
            <span className="pt-[3px] font-mono text-[11px] leading-[1.6] text-text-subtle">01</span>
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.09em] text-text-muted">Install</div>
              <CodeCopyRow command="yarn add @prism-analytics/core" />
            </div>
          </div>
          <div className="grid grid-cols-[32px_1fr] gap-2.5">
            <span className="pt-[3px] font-mono text-[11px] leading-[1.6] text-text-subtle">02</span>
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.09em] text-text-muted">Initialize</div>
              <CodeCopyRow command={INITIALIZE} prompt="$" />
            </div>
          </div>
          <div className="grid grid-cols-[32px_1fr] gap-2.5">
            <span className="pt-[3px] font-mono text-[11px] leading-[1.6] text-text-subtle">03</span>
            <div>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.09em] text-text-muted">Verify</div>
              <div className="flex h-[42px] items-center gap-2.5 rounded-[2px] border border-dashed border-border-strong px-3">
                <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-success" aria-hidden="true" />
                <span className="font-mono text-[13px] text-text-muted">Waiting for the first event</span>
                <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-success">Listening</span>
              </div>
            </div>
          </div>
        </div>
      </Frame>
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

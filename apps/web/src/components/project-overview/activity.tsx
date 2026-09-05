/**
 * Activity trend chart + releases panel. The chart draws the real
 * activity timeseries series (one to three) with a hover tooltip and
 * an accessible summary — no synthesized anomaly markers or release
 * bands. The side panel renders the real secondary artifact: release
 * rankings, issue rows, or an honest empty state.
 */
import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AssistantArtifact,
  MetricFact,
} from "@prism-analytics/types";
import { MkFrame, SectionLabel, Tag } from "@/components/project-overview/primitives";
import { evenXs } from "@/components/project-overview/chart-math";

const SERIES_COLORS = ["var(--text)", "var(--danger)", "var(--info)"] as const;

type Plottable = { name: string; points: Array<{ t: number; value: number }> };

function toPlottable(artifact: AssistantArtifact): Plottable[] | null {
  if (artifact.kind !== "timeseries") return null;
  return artifact.series.map((entry) => ({
    name: entry.name,
    points: [...entry.points].sort((a, b) => a.t - b.t),
  }));
}

function Label({ fact }: { fact: MetricFact }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-muted">
      {fact.label}
    </span>
  );
}

export function ActivityChart({
  artifact,
  supportingFact,
}: {
  artifact: AssistantArtifact;
  supportingFact?: MetricFact;
}) {
  const series = toPlottable(artifact);
  const tipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (!series || series.length === 0) return null;
    const w = 920;
    const h = 190;
    const pl = 42;
    const pr = 14;
    const pt = 18;
    const pb = 26;
    const iw = w - pl - pr;
    const ih = h - pt - pb;
    const count = Math.max(...series.map((entry) => entry.points.length));
    const max = Math.max(
      1,
      ...series.flatMap((entry) => entry.points.map((point) => point.value)),
    );
    const xs = evenXs(count, pl, iw);
    const paths = series.map((entry, seriesIndex) => {
      const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length] ?? "var(--text)";
      const d = entry.points
        .map((point, index) => {
          const x = xs[index] ?? pl;
          const y = pt + ih - (point.value / (max * 1.08)) * ih;
          return `${index === 0 ? "M" : "L"}${x} ${y}`;
        })
        .join(" ");
      return { name: entry.name, color, d };
    });
    return { w, h, pl, pr, pt, pb, iw, ih, xs, count, paths };
  }, [series]);

  if (!series || series.length === 0 || !geometry) {
    return (
      <MkFrame inset className="p-[12px_14px]">
        <div className="flex items-center gap-3 px-0 pb-2">
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Activity trend
          </h3>
        </div>
        <p className="py-6 text-center text-sm text-text-muted">
          {artifact.kind === "empty" ? artifact.reason : "No activity in this range."}
        </p>
        <span id={tipId} className="sr-only">
          {artifact.summary}
        </span>
      </MkFrame>
    );
  }

  const hovered =
    hover !== null
      ? series.map((entry) => entry.points[hover]).filter(Boolean)
      : [];
  const gridYs = [0, 1, 2, 3].map(
    (index) => geometry.pt + (geometry.ih * index) / 3,
  );

  return (
    <MkFrame inset>
      <div className="flex flex-wrap items-center gap-3 px-3.5 pt-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
          Activity trend
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-3.5" aria-hidden="true">
            {geometry.paths.map((entry) => (
              <span
                key={entry.name}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.04em] text-text-muted"
              >
                <span
                  className="inline-block h-2 w-2 rounded-[1px]"
                  style={{ background: entry.color }}
                />
                {entry.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="relative px-3.5 pb-3 pt-2">
        <svg
          viewBox={`0 0 ${geometry.w} ${geometry.h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={artifact.summary}
          className="block h-[164px] w-full cursor-crosshair touch-pan-y"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const px =
              ((event.clientX - rect.left) / rect.width) * geometry.w;
            let best = 0;
            let bestDist = Number.POSITIVE_INFINITY;
            geometry.xs.forEach((x, index) => {
              const dist = Math.abs(px - x);
              if (dist < bestDist) {
                bestDist = dist;
                best = index;
              }
            });
            setHover(best);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {gridYs.map((y) => (
            <line
              key={y}
              x1={geometry.pl}
              y1={y}
              x2={geometry.w - geometry.pr}
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
              opacity="0.9"
            />
          ))}
          {geometry.paths.map((entry) => (
            <path
              key={entry.name}
              d={entry.d}
              fill="none"
              stroke={entry.color}
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {geometry.xs.map((x) => (
            <rect
              key={x}
              x={x - 10}
              y={geometry.pt}
              width="20"
              height={geometry.ih}
              fill="transparent"
            />
          ))}
        </svg>
        {hover !== null && hovered.length > 0 ? (
          <output
            className="pointer-events-none absolute z-40 whitespace-nowrap rounded-sm border border-border-strong bg-surface-raised px-2 py-1.5 font-mono text-[10.5px] font-medium leading-[1.5] tracking-[0.02em] text-text shadow-[0_24px_80px_rgb(0_0_0/0.45)]"
            style={{
              left: Math.max(
                8,
                Math.min((geometry.xs[hover] ?? 0) - 70, geometry.w - 160),
              ),
              top: 0,
            }}
          >
            {(() => {
              const t = series[0]?.points[hover]?.t;
              const date =
                t !== undefined
                  ? new Date(t).toISOString().slice(0, 10)
                  : "";
              return (
                <>
                  {date}{" "}
                  {hovered.map((point, index) => (
                    <span key={series[index]?.name ?? index}>
                      <span className="font-normal text-text-subtle">
                        {series[index]?.name}
                      </span>{" "}
                      {(point?.value ?? 0).toLocaleString()}{" "}
                    </span>
                  ))}
                </>
              );
            })()}
          </output>
        ) : null}
        <span id={tipId} className="sr-only">
          {artifact.summary}
        </span>
      </div>
      {supportingFact ? (
        <p className="sr-only">
          <Label fact={supportingFact} /> {supportingFact.formattedValue}
        </p>
      ) : null}
    </MkFrame>
  );
}

function ReleaseRows({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "ranked-list" }>;
}) {
  return (
    <div className="px-0 pb-2 pt-1.5">
      {artifact.rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[auto_1fr_auto] gap-x-2.5 gap-y-[3px] border-t border-border px-3.5 py-2.5 first:border-t-0"
        >
          <span className="font-mono text-xs font-medium leading-[1.3] text-text">
            {row.label}
          </span>
          <span className="font-mono text-[11px] leading-[1.7] text-text-muted" />
          <span className="text-right font-mono text-[11px] leading-[1.7] text-text-muted tabular-nums">
            {row.value.toLocaleString()}
            {row.sharePercent !== null ? ` · ${row.sharePercent}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function IssueRows({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "issue-list" }>;
}) {
  return (
    <div className="px-0 pb-2 pt-1.5">
      {artifact.issues.map((issue) => (
        <div
          key={issue.id}
          className="grid grid-cols-[auto_1fr_auto] gap-x-2.5 gap-y-[3px] border-t border-border px-3.5 py-2.5 first:border-t-0"
        >
          <Tag tone={issue.status === "unresolved" ? "err" : "neu"}>
            {issue.delta === "new"
              ? "NEW"
              : (issue.delta ?? issue.status).toUpperCase()}
          </Tag>
          <span className="text-[11.5px] leading-[1.45] text-text-muted">
            <b className="font-semibold text-text">{issue.title}</b>
          </span>
          <span className="text-right font-mono text-[11px] leading-[1.7] text-text-muted tabular-nums">
            {issue.count} × {issue.users} users
          </span>
        </div>
      ))}
    </div>
  );
}

export function SecondaryPanel({ artifact }: { artifact: AssistantArtifact }) {
  const title =
    artifact.kind === "ranked-list" && artifact.entity === "release"
      ? "Recent releases"
      : artifact.title;
  return (
    <MkFrame inset>
      <div className="flex flex-wrap items-center gap-3 px-3.5 pt-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
          {title}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to={artifact.drilldown.destination}
            className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-sm px-3 text-xs font-medium text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text"
          >
            {artifact.drilldown.label} →
          </Link>
        </div>
      </div>
      {artifact.kind === "ranked-list" ? (
        <ReleaseRows artifact={artifact} />
      ) : artifact.kind === "issue-list" ? (
        <IssueRows artifact={artifact} />
      ) : (
        <p className="px-3.5 py-6 text-center text-sm text-text-muted">
          {artifact.kind === "empty" || artifact.kind === "unavailable"
            ? artifact.reason
            : artifact.summary}
        </p>
      )}
    </MkFrame>
  );
}

export function ActivitySection({
  activity,
  secondary,
  supportingFact,
}: {
  activity: AssistantArtifact;
  secondary: AssistantArtifact;
  supportingFact?: MetricFact;
}) {
  return (
    <>
      <SectionLabel>Activity &amp; releases</SectionLabel>
      <div className="grid grid-cols-[1.75fr_1fr] items-stretch gap-2.5 max-[1100px]:grid-cols-1">
        <ActivityChart artifact={activity} supportingFact={supportingFact} />
        <SecondaryPanel artifact={secondary} />
      </div>
    </>
  );
}

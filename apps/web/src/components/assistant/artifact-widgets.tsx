/**
 * Typed answer widgets (Task 21 slice 7).
 *
 * Every widget renders exact server values from its validated artifact —
 * numbers are never copied from model prose. Each widget carries its
 * accessible text summary plus drill-down navigation into the same
 * snapshot that produced the numbers.
 */
import { Link } from "react-router-dom";
import type {
  AssistantArtifact,
  MetricFact,
} from "@prism-analytics/types";
import { Frame } from "@/components/public/frame";
import { cn } from "@/lib/utils";

function comparisonText(fact: MetricFact): string | null {
  const comparison = fact.comparison;
  if (comparison === null) return null;
  if (comparison.kind === "new") return "new in this period";
  if (comparison.kind === "no-prior-data") return "no prior data";
  const arrow = comparison.direction === "up" ? "▲" : comparison.direction === "down" ? "▼" : "■";
  return `${arrow} ${Math.abs(comparison.percent ?? 0)}% vs previous`;
}

function DrilldownLink({
  destination,
  label,
  ctx,
  className,
}: {
  destination: string;
  label: string;
  ctx?: string;
  className?: string;
}) {
  const to = ctx ? `${destination}?ctx=${encodeURIComponent(ctx)}` : destination;
  return (
    <Link
      to={to}
      className={cn(
        "font-mono text-[11px] text-link transition-colors hover:underline",
        className,
      )}
    >
      {label} →
    </Link>
  );
}

function WidgetShell({
  artifact,
  children,
}: {
  artifact: AssistantArtifact;
  children: React.ReactNode;
}) {
  return (
    <Frame className="px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-text-subtle">
        {artifact.title}
      </p>
      <div className="mt-2">{children}</div>
      <p className="sr-only">{artifact.summary}</p>
      <div className="mt-3">
        <DrilldownLink
          destination={artifact.drilldown.destination}
          label={artifact.drilldown.label}
        />
      </div>
    </Frame>
  );
}

export function MetricWidget({ artifact }: { artifact: Extract<AssistantArtifact, { kind: "metric" }> }) {
  const fact = artifact.fact;
  return (
    <WidgetShell artifact={artifact}>
      <p className="font-mono text-3xl tabular-nums" aria-label={artifact.summary}>
        {fact.formattedValue}
        {fact.unit ? (
          <span className="ml-2 text-sm text-text-subtle">{fact.unit}</span>
        ) : null}
      </p>
      {comparisonText(fact) ? (
        <p className="mt-1 font-mono text-xs text-text-subtle">{comparisonText(fact)}</p>
      ) : null}
    </WidgetShell>
  );
}

export function ComparisonWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "comparison" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <dl className="grid grid-cols-2 gap-3">
        {(
          [
            ["Current", artifact.current],
            ["Previous", artifact.previous],
          ] as const
        ).map(([label, fact]) => (
          <div key={label}>
            <dt className="font-mono text-[11px] uppercase text-text-subtle">{label}</dt>
            <dd className="font-mono text-2xl tabular-nums">{fact.formattedValue}</dd>
          </div>
        ))}
      </dl>
    </WidgetShell>
  );
}

export function TimeseriesWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "timeseries" }>;
}) {
  const max = Math.max(
    1,
    ...artifact.series.flatMap((entry) => entry.points.map((point) => point.value)),
  );
  return (
    <WidgetShell artifact={artifact}>
      <div
        role="img"
        aria-label={artifact.summary}
        className="flex h-24 items-end gap-[3px]"
      >
        {artifact.series[0]?.points.map((point) => (
          <div
            key={point.t}
            className="min-w-[3px] flex-1 rounded-sm bg-accent/70"
            style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
            title={`${new Date(point.t).toISOString()}: ${point.value}`}
          />
        ))}
      </div>
      {artifact.series.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-text-subtle">
          {artifact.series.map((entry) => (
            <li key={entry.name}>{entry.name}</li>
          ))}
        </ul>
      ) : null}
      {/* Accessible data table for the chart. */}
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[11px] text-text-subtle hover:text-text">
          View data table
        </summary>
        <table className="mt-2 w-full font-mono text-[11px] tabular-nums">
          <tbody>
            {artifact.series[0]?.points.slice(0, 12).map((point) => (
              <tr key={point.t} className="border-t border-border-subtle">
                <td className="py-1 pr-3 text-text-subtle">
                  {new Date(point.t).toISOString().slice(0, 10)}
                </td>
                <td className="py-1 text-right">{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </WidgetShell>
  );
}

function ShareBar({ share }: { share: number | null }) {
  if (share === null) return null;
  return (
    <div
      className="mt-1 h-1 overflow-hidden rounded-full bg-border-subtle"
      aria-hidden="true"
    >
      <div className="h-full rounded-full bg-accent/70" style={{ width: `${share}%` }} />
    </div>
  );
}

export function RankedListWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "ranked-list" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <ol>
        {artifact.rows.map((row, index) => (
          <li key={row.key} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-xs">
                <span className="mr-2 text-text-subtle">{index + 1}.</span>
                {row.label}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums">{row.value}</span>
            </div>
            <ShareBar share={row.sharePercent} />
          </li>
        ))}
      </ol>
    </WidgetShell>
  );
}

export function BreakdownWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "breakdown" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <ol>
        {artifact.rows.map((row) => (
          <li key={row.key} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-xs">{row.label}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                {row.value}
                {row.sharePercent !== null ? (
                  <span className="ml-2 text-text-subtle">{row.sharePercent}%</span>
                ) : null}
              </span>
            </div>
            <ShareBar share={row.sharePercent} />
          </li>
        ))}
      </ol>
    </WidgetShell>
  );
}

export function TableWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "table" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border">
              {artifact.columns.map((column) => (
                <th key={column} className="px-2 py-1 text-left font-medium text-text-subtle">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, index) => (
              <tr key={index} className="border-b border-border-subtle last:border-b-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1">
                    {cell ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  );
}

export function IssueListWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "issue-list" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <ol>
        {artifact.issues.map((issue) => (
          <li key={issue.id} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-xs">{issue.title}</span>
              <span className="shrink-0 font-mono text-[11px] text-text-subtle">
                {issue.status} · {issue.count} × {issue.users} users
                {issue.delta ? ` · ${issue.delta}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </WidgetShell>
  );
}

export function CoverageWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "coverage" }>;
}) {
  const coverage = artifact.coverage;
  return (
    <WidgetShell artifact={artifact}>
      <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
        <div>
          <dt className="text-text-subtle">Sources configured</dt>
          <dd className="text-lg tabular-nums">{coverage.sourcesConfigured}</dd>
        </div>
        <div>
          <dt className="text-text-subtle">Sources active</dt>
          <dd className="text-lg tabular-nums">{coverage.sourcesActive}</dd>
        </div>
      </dl>
      {coverage.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {coverage.warnings.map((warning, index) => (
            <li key={index} className="font-mono text-[11px] text-warning">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetShell>
  );
}

export function DefinitionWidget({
  artifact,
  onConfirm,
  onReject,
  deciding,
}: {
  artifact: Extract<AssistantArtifact, { kind: "definition" }>;
  onConfirm?: () => void;
  onReject?: () => void;
  deciding?: boolean;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <p className="font-mono text-xs">{artifact.description}</p>
      <p className="mt-1 font-mono text-[11px] text-text-subtle">
        Status: {artifact.status}
      </p>
      {artifact.status === "proposed" && (onConfirm || onReject) ? (
        <div className="mt-3 flex gap-2">
          {onConfirm ? (
            <button
              type="button"
              disabled={deciding}
              onClick={onConfirm}
              className="rounded-md bg-accent px-3 py-1.5 font-mono text-xs text-white disabled:opacity-50"
            >
              Confirm definition
            </button>
          ) : null}
          {onReject ? (
            <button
              type="button"
              disabled={deciding}
              onClick={onReject}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs disabled:opacity-50"
            >
              Reject
            </button>
          ) : null}
        </div>
      ) : null}
    </WidgetShell>
  );
}

export function EmptyWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "empty" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <p className="font-mono text-xs text-text-subtle">{artifact.reason}</p>
    </WidgetShell>
  );
}

export function UnavailableWidget({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "unavailable" }>;
}) {
  return (
    <WidgetShell artifact={artifact}>
      <p className="font-mono text-xs">{artifact.reason}</p>
      <p className="mt-1 font-mono text-[11px] text-text-subtle">
        Next step: {artifact.nextAction}
      </p>
    </WidgetShell>
  );
}

/**
 * Render any artifact by its discriminated kind. The model selects a
 * tool; the tool result selects this widget — never the reverse.
 */
export function ArtifactWidget({
  artifact,
  definitionActions,
}: {
  artifact: AssistantArtifact;
  definitionActions?: {
    onConfirm: () => void;
    onReject: () => void;
    deciding: boolean;
  };
}) {
  switch (artifact.kind) {
    case "metric":
      return <MetricWidget artifact={artifact} />;
    case "comparison":
      return <ComparisonWidget artifact={artifact} />;
    case "timeseries":
      return <TimeseriesWidget artifact={artifact} />;
    case "breakdown":
      return <BreakdownWidget artifact={artifact} />;
    case "ranked-list":
      return <RankedListWidget artifact={artifact} />;
    case "table":
      return <TableWidget artifact={artifact} />;
    case "issue-list":
      return <IssueListWidget artifact={artifact} />;
    case "coverage":
      return <CoverageWidget artifact={artifact} />;
    case "definition":
      return (
        <DefinitionWidget
          artifact={artifact}
          onConfirm={definitionActions?.onConfirm}
          onReject={definitionActions?.onReject}
          deciding={definitionActions?.deciding}
        />
      );
    case "empty":
      return <EmptyWidget artifact={artifact} />;
    case "unavailable":
      return <UnavailableWidget artifact={artifact} />;
  }
}

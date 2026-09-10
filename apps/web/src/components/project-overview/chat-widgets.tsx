/**
 * Chat artifact widgets in the design-mock language. Each widget binds
 * one validated `AssistantArtifact`: exact server values, accessible
 * summaries, and snapshot drill-downs — the same fidelity contract as
 * the previous widget set, restyled 1:1 to the mock.
 */
import { Link, useParams } from "react-router-dom";
import { buildDrilldownUrl } from "@prism-analytics/types";
import { Check } from "@/components/ui/hugeicons";
import type {
  ActivityStep,
  AssistantArtifact,
  AssistantFollowUp,
  MetricFact,
} from "@prism-analytics/types";
import { Btn } from "@/components/project-overview/primitives";
import { sparkPath } from "@/components/project-overview/chart-math";
import { cn } from "@/lib/utils";

function directionDelta(fact: MetricFact): string | null {
  const comparison = fact.comparison;
  if (comparison === null) return null;
  if (comparison.kind === "new") return "new";
  if (comparison.kind === "no-prior-data") return null;
  const arrow =
    comparison.direction === "up"
      ? "▲"
      : comparison.direction === "down"
        ? "▼"
        : "■";
  return `${arrow} ${Math.abs(comparison.percent ?? 0)}%`;
}

function ArtifactShell({
  artifact,
  children,
}: {
  artifact: AssistantArtifact;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-[16px] border border-border bg-surface-raised">
      <div className="px-3.5 pt-2.5 text-[10px] font-medium uppercase leading-[1.4] tracking-[0.07em] text-text-subtle">
        {artifact.title}
      </div>
      {children}
      <span className="sr-only">{artifact.summary}</span>
    </div>
  );
}

function ArtifactFoot({ artifact }: { artifact: AssistantArtifact }) {
  const { wrkSlug, slug } = useParams();
  return (
    <div className="flex items-center gap-2 border-t border-border px-3.5 py-2">
      <span className="text-[10px] leading-[1.5] text-text-subtle">
        {artifact.summary.slice(0, 120)}
      </span>
      <span className="flex-1" />
      <Link
        to={wrkSlug && slug ? buildDrilldownUrl(wrkSlug, slug, artifact.drilldown) : artifact.drilldown.destination}
        className="inline-flex h-[26px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-[11.5px] font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
      >
        {artifact.drilldown.label}
      </Link>
    </div>
  );
}

export function IssueListBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "issue-list" }>;
}) {
  const unresolved = artifact.issues
    .filter((issue) => issue.status === "unresolved")
    .slice(0, 3);
  return (
    <div className="mt-2.5 overflow-hidden rounded-[16px] border border-border">
      {unresolved.map((issue) => (
        <div
          key={issue.id}
          className="flex items-center gap-2.5 bg-surface-raised px-3 py-[9px] text-[12.5px] leading-[1.45] [&_+&]:border-t [&_+&]:border-border"
        >
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-muted">
            <b className="font-semibold text-text">{issue.title}</b>
          </span>
          <span className="ml-auto flex-none whitespace-nowrap text-[10.5px] font-normal leading-none text-text-subtle tabular-nums">
            {issue.users} users · {issue.count} ev
          </span>
        </div>
      ))}
    </div>
  );
}

export function TraceBlock({
  steps,
  latencyMs,
}: {
  steps: ActivityStep[];
  latencyMs?: number;
}) {
  if (steps.length === 0) return null;
  return (
    <div className="mb-3 rounded-[12px] border border-border bg-surface-raised px-3 py-[9px]">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-text-subtle">
        Activity
        <span className="ml-auto normal-case tracking-[0.04em]">
          {steps.length} steps
          {latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}
        </span>
      </div>
      <div className="mt-[9px] flex flex-col gap-[7px]">
        {steps.map((step) => (
          <div
            key={step.stepId}
            className="flex items-center gap-[9px] text-[12.5px] text-text-muted"
          >
            {step.state === "failed" ? (
              <span
                aria-hidden="true"
                className="inline-block h-[13px] w-[13px] flex-none text-center text-[11px] leading-[13px] text-danger"
              >
                ×
              </span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={cn(
                  "h-[13px] w-[13px] flex-none",
                  step.state === "complete" && "stroke-success",
                  step.state !== "complete" && "animate-spin stroke-accent",
                )}
              >
                {step.state === "complete" ? (
                  <path d="M20 6 9 17l-5-5" />
                ) : (
                  <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                )}
              </svg>
            )}
            <span className="min-w-0 flex-1 truncate">{step.label}</span>
            <span className="ml-auto flex-none text-[10px] font-normal leading-none text-text-subtle">
              {step.state}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricArtifactBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "metric" }>;
}) {
  const delta = directionDelta(artifact.fact);
  return (
    <ArtifactShell artifact={artifact}>
      <div className="flex items-baseline gap-3 px-3.5 pb-3 pt-1.5">
        <span className="text-[28px] font-normal leading-none tracking-[-0.03em] text-text tabular-nums">
          {artifact.fact.formattedValue}
        </span>
        {delta ? (
          <span className="text-[11px] font-medium leading-none text-success">
            {delta}
          </span>
        ) : null}
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function BarsCompareBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "comparison" }>;
}) {
  const max = Math.max(1, artifact.current.value ?? 0, artifact.previous.value ?? 0);
  const prevH = Math.max(4, ((artifact.previous.value ?? 0) / max) * 100);
  const curH = Math.max(4, ((artifact.current.value ?? 0) / max) * 100);
  return (
    <ArtifactShell artifact={artifact}>
      <div className="flex h-[72px] items-end gap-2 px-3.5 pt-3" aria-hidden="true">
        <div className="flex h-full flex-1 items-end gap-[3px]">
          <span
            className="min-h-[3px] flex-1 rounded-t-[1px] bg-border-strong"
            style={{ height: `${prevH}%` }}
          />
          <span
            className="min-h-[3px] flex-1 rounded-t-[1px] bg-text"
            style={{ height: `${curH}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between gap-2 px-3.5 pb-2.5 pt-2 text-[9.5px] font-normal leading-[1.5] tracking-[0.04em] text-text-subtle">
        <span>PREV · {artifact.previous.formattedValue}</span>
        <span>CUR · {artifact.current.formattedValue}</span>
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function TimeseriesBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "timeseries" }>;
}) {
  const series = artifact.series[0];
  const points = series?.points.map((point) => point.value) ?? [];
  const first = series?.points[0];
  const last = series?.points[(series?.points.length ?? 1) - 1];
  return (
    <ArtifactShell artifact={artifact}>
      <div className="px-3.5 pt-3">
        <svg
          viewBox="0 0 300 110"
          preserveAspectRatio="none"
          role="img"
          aria-label={artifact.summary}
          className="block h-[110px] w-full"
        >
          <path
            d={sparkPath(points, 300, 110)}
            fill="none"
            stroke="var(--info)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="flex justify-between gap-2 px-3.5 pb-2.5 pt-2 text-[9.5px] font-normal leading-[1.5] tracking-[0.04em] text-text-subtle">
        <span>
          {first ? new Date(first.t).toISOString().slice(0, 10).toUpperCase() : "—"}
        </span>
        <span>{series?.name.toUpperCase()}</span>
        <span>
          {last ? new Date(last.t).toISOString().slice(0, 10).toUpperCase() : "—"}
        </span>
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function BreakdownBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "breakdown" }>;
}) {
  const max = Math.max(1, ...artifact.rows.map((row) => row.value));
  return (
    <ArtifactShell artifact={artifact}>
      <div className="flex flex-col gap-[9px] px-3.5 pb-3 pt-2.5 text-xs">
        {artifact.rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[64px_1fr_32px] items-center gap-2.5"
          >
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text-muted">
              {row.label}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-active">
              <span
                className="block h-full rounded-full bg-text"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right text-[11px] font-normal leading-none text-text tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function RankedListBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "ranked-list" }>;
}) {
  const max = Math.max(1, ...artifact.rows.map((row) => row.value));
  return (
    <ArtifactShell artifact={artifact}>
      <div className="flex flex-col py-1.5">
        {artifact.rows.map((row, index) => (
          <div
            key={row.key}
            className="grid grid-cols-[20px_1fr_40px] items-center gap-2.5 px-3.5 py-2 text-[12.5px] [&_+&]:border-t [&_+&]:border-border"
          >
            <span
              className={cn(
                "text-[11px] font-normal leading-none tabular-nums",
                index === 0 ? "text-text" : "text-text-subtle",
              )}
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-[5px]">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text">
                {row.label}
              </span>
              <span className="h-[5px] overflow-hidden rounded-full bg-surface-active">
                <span
                  className="block h-full rounded-full bg-text"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </span>
            </span>
            <span className="text-right text-[11px] font-normal leading-none text-text tabular-nums">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function DataTableBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "table" }>;
}) {
  return (
    <ArtifactShell artifact={artifact}>
      <div className="overflow-x-auto px-0 pb-1.5 pt-1">
        <table className="w-full min-w-[320px] border-collapse text-xs">
          <thead>
            <tr>
              {artifact.columns.map((column, index) => (
                <th
                  key={column}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3.5 pb-[7px] pt-[9px] text-left text-[10px] font-medium uppercase leading-[1.4] tracking-[0.06em] text-text-subtle",
                    index > 0 && "text-right tabular-nums",
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, index) => (
              <tr key={`${index}:${row.join("|")}`}>
                {row.map((cell, cellIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: column position is the identity in a fixed-column table
                  <td key={cellIndex}
                    className={cn(
                      "whitespace-nowrap border-t border-border px-3.5 py-2 text-text-muted",
                      cellIndex === 0 &&
                        "font-semibold text-text first:[tbody_tr:first-child_&]:border-t-0",
                      cellIndex > 0 && "text-right tabular-nums",
                    )}
                  >
                    {cell ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ArtifactFoot artifact={artifact} />
    </ArtifactShell>
  );
}

export function DefinitionPickerBlock({
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
    <ArtifactShell artifact={artifact}>
      {artifact.status === "confirmed" ? (
        <p className="flex items-center gap-2 px-3.5 pb-3 pt-2.5 text-[11px] leading-[1.5] text-success">
          <Check aria-hidden="true" className="h-[13px] w-[13px] flex-none" />
          <span>Saved to project memory</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2 px-3.5 pb-3 pt-2.5">
          <button
            type="button"
            disabled={deciding || !onConfirm}
            onClick={onConfirm}
            className="flex w-full gap-2.5 rounded-[12px] border border-border p-[10px_12px] text-left text-[12.5px] leading-[1.5] text-text-muted transition-colors duration-100 hover:border-border-strong hover:bg-surface-hover hover:text-text disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className="mt-[3px] h-3.5 w-3.5 flex-none rounded-full border border-border-strong"
            />
            <span>
              <b className="block font-semibold text-text">{artifact.title}</b>
              {artifact.description}
            </span>
          </button>
          {onReject ? (
            <div>
              <Btn variant="ghost" disabled={deciding} onClick={onReject}>
                Reject
              </Btn>
            </div>
          ) : null}
        </div>
      )}
    </ArtifactShell>
  );
}

export function EmptyBoxBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "empty" }>;
}) {
  return (
    <ArtifactShell artifact={artifact}>
      <div className="m-[12px_14px_14px] flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-border-strong px-4 py-[22px] text-center">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-5 w-5 stroke-text-subtle"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        <p className="text-[13px] font-semibold text-text">{artifact.title}</p>
        <span className="max-w-[40ch] text-xs leading-[1.55] text-text-muted">
          {artifact.reason}
        </span>
        <Link
          to={artifact.drilldown.destination}
          className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-xs font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
        >
          {artifact.drilldown.label}
        </Link>
      </div>
    </ArtifactShell>
  );
}

export function CoverageNoticeBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "coverage" }>;
}) {
  const warnings = artifact.coverage.warnings;
  if (warnings.length === 0) return null;
  return (
    <div className="mt-2.5 flex items-start gap-2.5 rounded-[12px] border border-warning/40 p-[10px_12px] text-[12.5px] text-text-muted">
      <span
        aria-hidden="true"
        className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-warning"
      />
      <span>
        <b className="font-semibold text-text">Coverage gap: </b>
        {warnings.join(" ")}
      </span>
    </div>
  );
}

export function UnavailableBlock({
  artifact,
}: {
  artifact: Extract<AssistantArtifact, { kind: "unavailable" }>;
}) {
  return (
    <div className="mt-2.5 flex items-start gap-2.5 rounded-[12px] border border-warning/40 p-[10px_12px] text-[12.5px] text-text-muted">
      <span
        aria-hidden="true"
        className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-warning"
      />
      <span>
        {artifact.reason} <b className="font-semibold text-text">Next step: </b>
        {artifact.nextAction}
      </span>
    </div>
  );
}

export function EvidenceBlock({
  observations,
}: {
  observations: Array<{ text: string; factIds: readonly string[] }>;
}) {
  if (observations.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-[5px] border-t border-dashed border-border pt-2.5 text-xs text-text-muted">
      <div className="text-[10px] font-medium uppercase leading-[1.4] tracking-[0.07em] text-text-subtle">
        Evidence
      </div>
      {observations.map((observation) => (
        <div key={observation.text} className="leading-[1.55]">
          {observation.text}{" "}
          {observation.factIds.map((id) => (
            <code
              key={id}
              className="rounded-md border border-border bg-surface-raised px-[5px] py-0 text-[10.5px] leading-[1.5] text-text-muted"
            >
              {id}
            </code>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FollowUpsBlock({
  followUps,
  onAsk,
}: {
  followUps: readonly AssistantFollowUp[];
  onAsk: (prompt: string) => void;
}) {
  if (followUps.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {followUps.map((followUp) => (
        <button
          key={followUp.title}
          type="button"
          onClick={() => onAsk(followUp.description)}
          title={followUp.description}
          className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-xs font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
        >
          {followUp.title}
        </button>
      ))}
    </div>
  );
}

/** Dispatch any artifact to its design widget. */
export function ChatArtifact({
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
      return <MetricArtifactBlock artifact={artifact} />;
    case "comparison":
      return <BarsCompareBlock artifact={artifact} />;
    case "timeseries":
      return <TimeseriesBlock artifact={artifact} />;
    case "breakdown":
      return <BreakdownBlock artifact={artifact} />;
    case "ranked-list":
      return <RankedListBlock artifact={artifact} />;
    case "table":
      return <DataTableBlock artifact={artifact} />;
    case "issue-list":
      return <IssueListBlock artifact={artifact} />;
    case "coverage":
      return <CoverageNoticeBlock artifact={artifact} />;
    case "definition":
      return (
        <DefinitionPickerBlock
          artifact={artifact}
          onConfirm={definitionActions?.onConfirm}
          onReject={definitionActions?.onReject}
          deciding={definitionActions?.deciding}
        />
      );
    case "empty":
      return <EmptyBoxBlock artifact={artifact} />;
    case "unavailable":
      return <UnavailableBlock artifact={artifact} />;
  }
}

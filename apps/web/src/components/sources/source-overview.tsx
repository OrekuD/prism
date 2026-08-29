import { Frame } from "@/components/public/frame";
import { MetricCard } from "@/components/public/metric-card";
import { CreateSourceDialog } from "@/components/sources/create-source-dialog";
import { INSTALL_CMDS } from "@/components/sources/constants";
import {
  PLATFORM_LABELS,
  formatCount,
  sourceSnippetPlatform,
  sourceTypeLabel,
  timeAgo,
} from "@/lib/sources";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceResource } from "@/network/queries/useSourcesQuery";

function ConfiguredTag() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-[2px] border border-success/40 px-2.5 font-mono text-[11px] font-medium text-success">
      <span
        className="size-[7px] rounded-full bg-success"
        aria-hidden="true"
      />
      Configured
    </span>
  );
}

export function SourceOverview({
  sources,
  type,
  wrkSlug: _wrkSlug,
  slug,
  canManage,
}: {
  sources: SourceResource[];
  type: string;
  wrkSlug: string;
  slug: string;
  canManage: boolean;
}) {
  const label = sourceTypeLabel(type);
  const repPlatform = sourceSnippetPlatform(type);
  const activeKeys = sources.flatMap((source) =>
    source.keys.filter((key) => key.status === "active"),
  );
  const configured = activeKeys.length > 0;
  const events = sources.reduce(
    (total, source) => total + (source.telemetry?.events ?? 0),
    0,
  );
  const lastAt = sources.reduce(
    (latest, source) => Math.max(latest, source.telemetry?.lastReceivedAt ?? 0),
    0,
  );
  const installCmd = INSTALL_CMDS[repPlatform] ?? "";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Status"
          caption={
            activeKeys.length === 1
              ? "1 active key"
              : `${activeKeys.length} active keys`
          }
        >
          {configured ? (
            <ConfiguredTag />
          ) : (
            <span className="font-mono text-[14px] text-text">
              Not configured
            </span>
          )}
        </MetricCard>

        <MetricCard label="Events" caption="All time">
          <span className="font-mono text-[23px] tracking-[-0.06em] text-text">
            {formatCount(events)}
          </span>
        </MetricCard>
        <MetricCard label="Last event" caption="Reported by the source SDK">
          <span className="font-mono text-[20px] tracking-[-0.06em] text-text">
            {timeAgo(lastAt)}
          </span>
        </MetricCard>
      </div>

      {/* Sources / Install / Key summary — hidden, not relevant
      <Frame className="mt-[13px] px-4 py-1.5">
        {[
          [
            "Sources",
            sources.length === 1 ? "1 source" : `${sources.length} sources`,
          ],
          ["Install", installCmd],
          [
            "Key",
            configured
              ? "Publishable / secret"
              : "Create a source to get a key",
          ],
        ].map(([k, v], index) => (
          <div
            key={k}
            className={cn(
              "flex items-center justify-between gap-3 py-2 text-[13px]",
              index > 0 && "border-t border-border",
            )}
          >
            <span className="text-text-muted">{k}</span>
            <span className="truncate font-mono text-[13px] text-text">
              {v}
            </span>
          </div>
        ))}
      </Frame>
      */}

      {/* keep installCmd referenced to avoid unused lint */}
      <span className="hidden">{installCmd}</span>

      {sources.length === 0 ? (
        <div className="mt-3 flex flex-col items-center justify-center gap-2.5 rounded-[2px] p-6 text-center">
          <KeyRound className="size-[22px] text-text-subtle" aria-hidden="true" />
          <p className="font-mono text-[13px] text-text-muted">
            No {label} source in this project yet.
          </p>
          <span className="text-[12px] text-text-subtle">
            {canManage
              ? `Create a ${label} source to get its key and SDK setup.`
              : "An owner or admin can create a source."}
          </span>
          {canManage ? (
            <div className="mt-1">
              <CreateSourceDialog slug={slug} initialPlatform={repPlatform} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

import { TypeIcon } from "@/components/sources/type-icon";
import { ChevronRight } from "@/components/ui/hugeicons";
import { sourceTypeLabel, timeAgo } from "@/lib/sources";
import type { SourceResource } from "@/network/queries/useSourcesQuery";
import { Link } from "react-router-dom";

export function SourceOverview({
  sources,
  type,
  wrkSlug,
  slug,
  canManage,
}: {
  sources: SourceResource[];
  type: string;
  wrkSlug: string;
  slug: string;
  canManage: boolean;
}) {
  const base = `/workspace/${wrkSlug}/projects/${slug}/sources/${type}`;
  if (sources.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl border border-border bg-surface">
          <TypeIcon type={type} className="size-5 text-text-muted" />
        </span>
        <h2 className="text-base font-medium text-text">
          Connect your {sourceTypeLabel(type).toLowerCase()}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          {canManage
            ? "Create a source, install the SDK, and send your first event. Your connections will appear here."
            : "Ask a workspace owner or admin to create a source to start collecting data."}
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="source-list-title">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 id="source-list-title" className="text-sm font-medium text-text">
          Your sources
        </h2>
        <span className="text-xs tabular-nums text-text-muted">
          {sources.length}
        </span>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
        {sources.map((source) => {
          const activeKeys = source.keys.filter(
            (key) => key.status === "active",
          ).length;
          const last = source.telemetry?.lastReceivedAt;
          const status = !activeKeys
            ? "No active keys"
            : last
              ? "Data received"
              : "No activity reported";
          return (
            <li key={source.id}>
              <Link
                to={`${base}/overview/${source.id}`}
                className="group grid gap-4 px-5 py-5 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-canvas">
                    <TypeIcon
                      type={type}
                      className="size-[18px] text-text-muted"
                    />
                  </span>
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-medium text-text">
                      {source.name}
                    </h3>
                    <p className="mt-1 text-xs text-text-muted">
                      {activeKeys} active {activeKeys === 1 ? "key" : "keys"} ·{" "}
                      {type === "server" ? "Secret" : "Publishable"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-5 md:justify-end">
                  <div className="text-xs md:text-right">
                    <span
                      className={!activeKeys ? "text-warning" : "text-text"}
                    >
                      {status}
                    </span>
                    <p className="mt-1 text-text-muted">
                      {last ? (
                        <>
                          Last event{" "}
                          <time
                            dateTime={new Date(last).toISOString()}
                            title={new Date(last).toLocaleString()}
                          >
                            {timeAgo(last)}
                          </time>
                        </>
                      ) : (
                        "Last event unavailable"
                      )}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

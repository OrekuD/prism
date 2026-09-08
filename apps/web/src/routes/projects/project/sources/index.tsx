import { Frame } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { SourceKeys } from "@/components/sources/source-keys";
import { SourceOverview } from "@/components/sources/source-overview";
import { SourceSettings } from "@/components/sources/source-settings";
import { SourceSetup } from "@/components/sources/source-setup";
import { TypeIcon } from "@/components/sources/type-icon";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateSourceDialog } from "@/components/sources/create-source-dialog";
import {
  SOURCE_TABS,
  SOURCE_TYPES,
  SOURCE_TYPE_PLATFORMS,
  SOURCE_TYPE_WORDS,
  sourceSnippetPlatform,
} from "@/lib/sources";
import { cn } from "@/lib/utils";
import { useActiveMember } from "@/lib/workspace";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import {
  type SourceResource,
  useSourcesQuery,
} from "@/network/queries/useSourcesQuery";
import { Outlet, useNavigate, useParams } from "react-router-dom";

const TAB_WORDS = SOURCE_TABS.filter((entry) => entry.tab !== "settings").map(
  (entry) => entry.tab
);

// -------------------------------------------------------------------- page

export function ProjectSources() {
  const {
    slug,
    wrkSlug,
    type: typeParam,
    tab: tabParam,
    seg,
  } = useParams<{
    slug: string;
    wrkSlug: string;
    type?: string;
    tab?: string;
    seg?: string;
  }>();
  const navigate = useNavigate();
  // URL is the source of truth; unknown values fall back to defaults. The
  // type rides in `type` on the /:type/:tab route and in `seg` when it
  // arrives through the single-segment dispatch route (sources/:seg).
  const rawType = typeParam ?? seg;
  const type = rawType && SOURCE_TYPE_WORDS.includes(rawType) ? rawType : "web";
  const tab = tabParam && TAB_WORDS.includes(tabParam) ? tabParam : "overview";

  const { data, isLoading, isError, refetch } = useSourcesQuery(slug);
  const projectQuery = useProjectQuery({ slug, duration: "seven-days" });
  const activeMember = useActiveMember();

  const canManage =
    activeMember?.data?.role === "owner" ||
    activeMember?.data?.role === "admin";

  const allSources = (data ?? []) as SourceResource[];
  const sources = allSources.filter((source) =>
    SOURCE_TYPE_PLATFORMS[type as keyof typeof SOURCE_TYPE_PLATFORMS].includes(
      source.platform
    )
  );
  const projectName = (projectQuery.data as { name?: string } | undefined)
    ?.name;
  const basePath = `/workspace/${wrkSlug}/projects/${slug}/sources`;

  if (!slug || !wrkSlug) return null;

  return (
    <div className="flex flex-1 flex-col space-y-10">
      <PageHeader
        title="Sources"
        description={`SDK sources for ${
          projectName ?? "this project"
        }. Pick a source to get its setup, keys, and settings.`}
      />

      <div className="mb-3 text-[13px] font-medium tracking-normal text-text-subtle">
        Sources
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Frame key={i} className="p-3.5">
              <Skeleton className="size-[30px]" />
              <Skeleton className="mt-2 h-[14px] w-2/3" />
              <Skeleton className="mt-2 h-[11px] w-1/2" />
            </Frame>
          ))}
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="tablist"
          aria-label="Source types"
        >
          {SOURCE_TYPES.map((entry) => {
            const keysOfType = allSources
              .filter((source) =>
                SOURCE_TYPE_PLATFORMS[entry.type].includes(source.platform)
              )
              .flatMap((source) =>
                source.keys.filter((key) => key.status === "active")
              );
            const active = entry.type === type;
            const statusText =
              keysOfType.length > 0
                ? `Configured · ${keysOfType.length} ${
                    keysOfType.length === 1 ? "key" : "keys"
                  }`
                : "Not configured";
            return (
              <button
                key={entry.type}
                type="button"
                onClick={() => navigate(`${basePath}/${entry.type}`)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-[16px] border p-[14px_14px_12px] text-left transition-colors",
                  active
                    ? "border-accent/45 bg-accent-soft"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover"
                )}
                role="tab"
                aria-selected={active}
              >
                <span
                  className={cn(
                    "grid size-[30px] place-items-center rounded-[10px] border bg-surface-raised",
                    active
                      ? "border-accent/40 text-accent"
                      : "border-border text-text-muted"
                  )}
                >
                  <TypeIcon type={entry.type} className="size-[15px]" />
                </span>
                <b className="text-[13px] font-[550] text-text">
                  {entry.label}
                </b>
                <span className="font-mono text-[11px] leading-[1.3] text-text-subtle">
                  {statusText}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <fieldset className="inline-flex w-fit items-center overflow-hidden rounded-full border border-border p-0">
          <legend className="sr-only">Source configuration</legend>
          {SOURCE_TABS.filter((entry) => entry.tab !== "settings").map(
            (entry, index) => (
              <button
                key={entry.tab}
                type="button"
                onClick={() => navigate(`${basePath}/${type}/${entry.tab}`)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 px-3.5 text-[13px] font-medium transition-colors",
                  index > 0 && "border-l border-border",
                  tab === entry.tab
                    ? "bg-accent-soft text-text"
                    : "text-text-muted hover:bg-surface-hover hover:text-text"
                )}
                aria-pressed={tab === entry.tab}
              >
                {entry.label}
              </button>
            )
          )}
        </fieldset>
        {sources.length > 0 && canManage ? (
          <CreateSourceDialog
            slug={slug}
            initialPlatform={sourceSnippetPlatform(type)}
          />
        ) : null}
      </div>

      {isError ? (
        <ErrorState
          title="Could not load sources"
          description="Prism could not reach the API."
          onRetry={() => refetch()}
        />
      ) : (
        <Frame className="mt-[13px] p-5">
          {tab === "setup" ? (
            <SourceSetup type={type} wrkSlug={wrkSlug} slug={slug} />
          ) : tab === "keys" ? (
            <SourceKeys
              sources={sources}
              type={type}
              wrkSlug={wrkSlug}
              slug={slug}
              canManage={canManage}
            />
          ) : tab === "settings" ? (
            <SourceSettings />
          ) : (
            <SourceOverview
              sources={sources}
              type={type}
              wrkSlug={wrkSlug}
              slug={slug}
              canManage={canManage}
            />
          )}
        </Frame>
      )}
      <Outlet />
    </div>
  );
}

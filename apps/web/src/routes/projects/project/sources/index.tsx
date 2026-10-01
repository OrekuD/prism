import { PageHeader } from "@/components/public/page-header";
import { SourceKeys } from "@/components/sources/source-keys";
import { SourceOverview } from "@/components/sources/source-overview";
import { SourceSetup } from "@/components/sources/source-setup";
import { TypeIcon } from "@/components/sources/type-icon";
import { CreateSourceDialog } from "@/components/sources/create-source-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SOURCE_TYPES,
  SOURCE_TYPE_PLATFORMS,
  SOURCE_TYPE_WORDS,
  type SourceType,
} from "@/lib/sources";
import { cn } from "@/lib/utils";
import { useActiveMember } from "@/lib/workspace";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import { Link, Navigate, Outlet, useParams } from "react-router-dom";

const DESCRIPTIONS: Record<SourceType, string> = {
  web: "Connect websites and web apps with the Browser or React SDK.",
  mobile: "Connect your iOS and Android apps with the React Native SDK.",
  server: "Send backend events and errors securely with the Node SDK.",
};
const VIEWS = [
  { tab: "overview", label: "Sources" },
  { tab: "setup", label: "SDK setup" },
  { tab: "keys", label: "Keys" },
];

export function ProjectSources() {
  const { slug, wrkSlug, type: typeParam, tab: tabParam, seg } = useParams();
  const rawType = typeParam ?? seg;
  const type = (
    rawType && SOURCE_TYPE_WORDS.includes(rawType) ? rawType : "web"
  ) as SourceType;
  const tab = VIEWS.some((view) => view.tab === tabParam)
    ? tabParam
    : "overview";
  const { data, isLoading, isError, refetch } = useSourcesQuery(slug);
  const member = useActiveMember();
  const canManage =
    member?.data?.role === "owner" || member?.data?.role === "admin";
  const sources = (data ?? []).filter((source) =>
    SOURCE_TYPE_PLATFORMS[type].includes(source.platform),
  );
  const basePath = `/workspace/${wrkSlug}/projects/${slug}/sources`;
  if (!slug || !wrkSlug) return null;
  if (tabParam && !VIEWS.some((view) => view.tab === tabParam)) {
    return <Navigate replace to={`${basePath}/${type}/overview`} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-text">
            Sources
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            The apps and services sending data to this project.
          </p>
        </div>
        {canManage ? (
          <CreateSourceDialog key={type} slug={slug} initialPlatform={type} />
        ) : null}
      </header>

      <nav aria-label="Source types" className="flex w-fit flex-wrap gap-x-6 border-b border-border">
        {SOURCE_TYPES.map((entry) => {
          return (
            <Link
              key={entry.type}
              to={`${basePath}/${entry.type}`}
              aria-current={type === entry.type ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 border-b-2 px-0.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                type === entry.type
                  ? "border-text text-text"
                  : "border-transparent text-text-muted hover:text-text",
              )}
            >
              <TypeIcon type={entry.type} className="size-4" />
              {entry.label}
            </Link>
          );
        })}
      </nav>

      <div>
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface">
            <TypeIcon type={type} className="size-4 text-text-muted" />
          </span>
          <div>
            <h2 className="text-sm font-medium text-text">
              {SOURCE_TYPES.find((entry) => entry.type === type)?.label}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{DESCRIPTIONS[type]}</p>
          </div>
        </div>
        <nav
          aria-label="Source configuration"
          className="mt-6 flex gap-6 border-b border-border"
        >
          {VIEWS.map((view) => (
            <Link
              key={view.tab}
              to={`${basePath}/${type}/${view.tab}`}
              aria-current={tab === view.tab ? "page" : undefined}
              className={cn(
                "border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus",
                tab === view.tab
                  ? "border-text text-text"
                  : "border-transparent text-text-muted hover:text-text",
              )}
            >
              {view.label}
            </Link>
          ))}
        </nav>
      </div>

      {isLoading ? (
        <output
          aria-label="Loading sources"
          className="space-y-4 rounded-2xl border border-border p-5"
        >
          <span className="sr-only">Loading sources</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </output>
      ) : isError ? (
        <ErrorState
          title="Could not load sources"
          description="Prism could not reach the API."
          onRetry={() => refetch()}
        />
      ) : tab === "setup" ? (
        <SourceSetup key={type} type={type} />
      ) : tab === "keys" ? (
        <SourceKeys
          key={type}
          sources={sources}
          type={type}
          wrkSlug={wrkSlug}
          slug={slug}
          canManage={canManage}
        />
      ) : (
        <SourceOverview
          sources={sources}
          type={type}
          wrkSlug={wrkSlug}
          slug={slug}
          canManage={canManage}
        />
      )}
      <Outlet />
    </div>
  );
}

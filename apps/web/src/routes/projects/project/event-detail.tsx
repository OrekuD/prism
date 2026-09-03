import type { EventResource, StandardEventAttribution } from "@prism-analytics/types";
import { useQueryClient } from "@tanstack/react-query";
import React, { useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Frame, SectionLabel } from "@/components/public/frame";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agoLabel,
  clockLabel,
  isoLabel,
  platformDotClass,
  platformFamily,
  platformLabel,
} from "@/lib/events";
import { cn } from "@/lib/utils";

/**
 * Event detail (task-16 dashboard slice) — a route-backed Sheet.
 *
 * Same URL-as-state pattern as the Errors issue sheet: `/events/:eventId`
 * renders the list (still mounted through <Outlet />) with the event in a
 * Sheet. Browser back or Escape closes it; refresh or a pasted link keeps
 * it open. Closing navigates deterministically to the list base.
 *
 * The header renders from the loaded events cache (instant open); the body
 * shows the complete stored payload — identifiers, timing/SDK, trusted
 * source attribution, identity, sanitized properties and context — grouped
 * like the v2 design drawer. Values are escaped text nodes, never HTML.
 */

const ENTRIES_PREFIX = (slug: string | undefined) => ["project-events", slug];

function findEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  slug: string | undefined,
  eventId: string | undefined
): EventResource | undefined {
  if (!slug || !eventId) return undefined;
  const entries = queryClient.getQueriesData<unknown>({
    queryKey: ENTRIES_PREFIX(slug),
  });
  for (const [, payload] of entries) {
    if (!payload) continue;
    // New paginated shape: { events, nextCursor }
    const events = Array.isArray(payload)
      ? (payload as EventResource[])
      : ((payload as { events?: EventResource[] }).events ?? null);
    if (!events) continue;
    const found = events.find((event) => event.id === eventId);
    if (found) return found;
  }
  return undefined;
}

function useEventFromCache(
  slug: string | undefined,
  eventId: string | undefined
): EventResource | undefined {
  const queryClient = useQueryClient();
  return useSyncExternalStore(
    (callback) => queryClient.getQueryCache().subscribe(callback),
    () => findEvent(queryClient, slug, eventId),
    () => undefined
  );
}

/** Key/value cell like the v2 `ev-detail-kv` — now a Frame. */
function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Frame inset className="min-w-0 px-3 py-3">
      <div className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle">
        {k}
      </div>
      <div className="break-words font-mono text-[12.5px] leading-[1.5] text-text">
        {children}
      </div>
    </Frame>
  );
}

function NullValue({ label = "null" }: { label?: string }) {
  return <span className="font-mono text-text-subtle">{label}</span>;
}

function ShikiJson({ code }: { code: string }) {
  const [html, setHtml] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code, { lang: "json", theme: "github-dark" })
      )
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (html) {
    return (
      <div
        className="max-h-[320px] overflow-auto p-4 font-mono text-[12px] leading-[1.65] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:p-0 [&_code]:!bg-transparent"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML is trusted
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-[12px] leading-[1.65] text-[#e6edf3]">
      {code}
    </pre>
  );
}

function JsonBlock({
  value,
  emptyLabel = "No values stored.",
}: {
  value: Record<string, unknown> | null | undefined;
  emptyLabel?: string;
}) {
  if (!value || Object.keys(value).length === 0) {
    return (
      <Frame
       
        className="border-dashed bg-surface/40 px-3 py-6 text-center"
      >
        <p className="font-mono text-[12px] leading-none text-text-subtle">
          {emptyLabel}
        </p>
      </Frame>
    );
  }
  const code = JSON.stringify(value, null, 2);
  return (
    <Frame className="bg-[#0d1117] p-0">
      <ShikiJson code={code} />
    </Frame>
  );
}

function Tag({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "ok";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-2 py-1 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.07em]",
        tone === "ok"
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-surface text-text-muted"
      )}
    >
      {children}
    </span>
  );
}

export function EventDetails({ event, base }: { event: EventResource; base: string }) {
  const platform = event.platform ?? event.source?.platform ?? null;
  const lagMs = Math.max(0, event.receivedAt - event.occurredAt);
  const std = (event as EventResource & { standardEvent?: StandardEventAttribution | null }).standardEvent ?? null;
  const payload = React.useMemo(
    () =>
      JSON.stringify(
        {
          id: event.id,
          name: event.name,
          type: event.type ?? "track",
          occurredAt: event.occurredAt,
          receivedAt: event.receivedAt,
          sessionId: event.sessionId,
          properties: event.properties,
          source: event.source ?? null,
          person: {
            personId: event.personId ?? null,
            userId: event.userId ?? null,
            anonymousId: event.anonymousId ?? null,
          },
          sdk:
            event.sdkName || event.sdkVersion
              ? { name: event.sdkName, version: event.sdkVersion }
              : null,
          context: event.context ?? null,
          schema_version: event.schemaVersion,
        },
        null,
        2
      ),
    [event]
  );
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(payload, { lang: "json", theme: "github-dark" })
      )
      .then((out) => {
        if (!cancelled) setHighlighted(out);
      })
      .catch(() => {
        if (!cancelled) setHighlighted(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <>
      <SheetHeader className="gap-3 border-b border-border px-6 pb-4 pt-6 pr-10">
        <div className="min-w-0">
          <SheetTitle className="break-words pr-2 text-left font-sans text-[17px] font-semibold leading-[1.25] tracking-[-0.02em] text-text">
            {std ? std.displayName : event.name}
          </SheetTitle>
          {std ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-[2px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-text-subtle" aria-hidden="true">
                Standard
              </span>
              <span className="font-mono text-[10px] uppercase leading-none tracking-[0.05em] text-text-subtle" aria-hidden="true">
                {std.category}
              </span>
              <span className="font-mono text-[10px] leading-none text-text-subtle" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] leading-none text-text-subtle" title={event.name}>
                {event.name}
              </span>
              <span className="sr-only">{`Standard ${std.category}, ${std.displayName}, raw name ${event.name}`}</span>
            </div>
          ) : null}
          <p
            className="mt-1.5 flex flex-wrap items-center gap-1.5 font-sans text-[11px] leading-none text-text-subtle"
            title={isoLabel(event.occurredAt)}
          >
            <span className="tabular-nums">{humanAt(event.occurredAt)}</span>
            <span className="size-1 rounded-full bg-border-strong" aria-hidden />
            <span className="tabular-nums">{agoLabel(event.occurredAt)}</span>
          </p>
        </div>

      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6">
        <section>
          <SectionLabel>Timing & SDK</SectionLabel>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Kv k="occurred_at (client)">
              <span
                className="font-sans text-[12px] leading-[1.5] tracking-[-0.01em] text-text"
                title={isoLabel(event.occurredAt)}
              >
                {humanAt(event.occurredAt)}
                <span className="mx-1.5 text-text-subtle">·</span>
                <span className="text-text-subtle">{agoLabel(event.occurredAt)}</span>
              </span>
            </Kv>
            <Kv k="received_at (server)">
              <span
                className="font-sans text-[12px] leading-[1.5] tracking-[-0.01em] text-text"
                title={isoLabel(event.receivedAt)}
              >
                {humanAt(event.receivedAt)}
                <span className="mx-1.5 text-text-subtle">·</span>
                <span className="tabular-nums text-text-subtle">
                  +{fmtLag(lagMs)} ms
                </span>
              </span>
            </Kv>
            <Kv k="sdk">
              {event.sdkName ? (
                <span className="break-all">
                  {event.sdkName} @ {event.sdkVersion ?? "?"}
                </span>
              ) : (
                <span className="text-text-subtle">—</span>
              )}
            </Kv>
            <Kv k="platform">
              {platform ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      platformDotClass(platform),
                    )}
                    aria-hidden="true"
                  />
                  <span>{platformLabel(platform)}</span>
                </span>
              ) : (
                <span className="text-text-subtle">—</span>
              )}
            </Kv>
            <Kv k="source">
              {event.source ? (
                <span className="font-mono text-[12.5px] font-medium leading-none tracking-[-0.01em] text-text">
                  {event.source.name}
                </span>
              ) : (
                <span className="font-mono text-[12px] leading-none text-text-subtle">
                  —
                </span>
              )}
            </Kv>
            <Kv k="schema">
              <span className="font-mono">v{event.schemaVersion}</span>
            </Kv>
          </div>
        </section>

        <section>
          <SectionLabel>Person & session</SectionLabel>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Kv k="person_id (Prism person)">
              {event.personId ? (
                <span className="break-all text-[11px] leading-[1.5] tracking-[-0.01em]">
                  {event.personId}
                </span>
              ) : (
                <NullValue />
              )}
            </Kv>
            <Kv k="user_id (identify)">
              {event.userId ? (
                <span className="break-all">{event.userId}</span>
              ) : (
                <NullValue label="null — anonymous" />
              )}
            </Kv>
            <Kv k="anonymous_id (SDK)">
              {event.anonymousId ? (
                <span className="break-all text-[11px] leading-[1.5] tracking-[-0.01em]">
                  {event.anonymousId}
                </span>
              ) : (
                <NullValue />
              )}
            </Kv>
            <Kv k="session_id">
              {event.sessionId ? (
                <span className="break-all text-[11px] leading-[1.5] tracking-[-0.01em]">
                  {event.sessionId}
                </span>
              ) : (
                <NullValue label="null — server event has no session" />
              )}
            </Kv>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Properties</SectionLabel>
            {event.properties && Object.keys(event.properties).length > 0 ? (
              <CopyButton
                value={JSON.stringify(event.properties, null, 2)}
                iconOnly
                className="size-7"
              />
            ) : null}
          </div>
          <div className="mt-3">
            <JsonBlock value={event.properties} emptyLabel="No properties." />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Context</SectionLabel>
            {event.context && Object.keys(event.context).length > 0 ? (
              <CopyButton
                value={JSON.stringify(event.context, null, 2)}
                iconOnly
                className="size-7"
              />
            ) : null}
          </div>
          <div className="mt-3">
            <JsonBlock value={event.context} emptyLabel="No context." />
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Complete payload</SectionLabel>
            <CopyButton value={payload} iconOnly className="size-7" />
          </div>
          <Frame className="mt-3 bg-[#0d1117] p-0">
            {highlighted ? (
              <div
                className="max-h-[320px] overflow-auto p-4 font-mono text-[12px] leading-[1.65] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:p-0 [&_code]:!bg-transparent"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML is trusted — generated from stringified event JSON
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : (
              <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-[12px] leading-[1.65] text-[#e6edf3]">
                {payload}
              </pre>
            )}
          </Frame>
        </section>
      </div>
    </>
  );
}

function fmtLag(ms: number): string {
  return ms.toLocaleString("en-US");
}

function humanAt(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}

function EventDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="mt-2 grid grid-cols-2 gap-3">
        <Skeleton className="h-[76px] w-full rounded-[2px]" />
        <Skeleton className="h-[76px] w-full rounded-[2px]" />
        <Skeleton className="h-[76px] w-full rounded-[2px]" />
        <Skeleton className="h-[76px] w-full rounded-[2px]" />
      </div>
      <Skeleton className="h-[120px] w-full rounded-[2px]" />
    </div>
  );
}

function EventMissing({ base }: { base: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-sans text-[14px] font-medium tracking-[-0.01em] text-text">
        Event not in window
      </p>
      <p className="max-w-[320px] text-pretty font-mono text-[12.5px] leading-[1.5] text-text-muted">
        This event isn't in the loaded window. It may have fallen outside the
        latest 200 events or filters changed after the link was copied.
      </p>
      <Link
        to={base}
        className="mt-1 inline-flex h-8 items-center rounded-[2px] border border-border bg-surface px-3 font-mono text-[12px] font-medium text-text hover:bg-surface-hover"
      >
        Back to events
      </Link>
    </div>
  );
}

export function EventDetail() {
  const { slug, wrkSlug, eventId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const event = useEventFromCache(slug, eventId);

  const base = `/workspace/${wrkSlug ?? ""}/projects/${slug ?? ""}/events`;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) navigate(base);
      }}
    >
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[684px]">
        {event ? (
          <EventDetails event={event} base={base} />
        ) : queryClient
            .getQueryCache()
            .findAll({ queryKey: ENTRIES_PREFIX(slug) })
            .some((query) => query.state.status === "pending") ? (
          <EventDetailSkeleton />
        ) : (
          <EventMissing base={base} />
        )}
      </SheetContent>
    </Sheet>
  );
}

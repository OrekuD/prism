import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";
import { useParams } from "react-router-dom";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ProjectEvents() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, isError, refetch } = useProjectEventsQuery(slug);

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Events</CardTitle>
        <CardDescription>
          Named events captured by the Prism SDK on this project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <ErrorState
            title="Could not load events"
            description="Prism could not reach the events store. Check your connection and try again."
            onRetry={() => refetch()}
          />
        ) : data && data.length > 0 ? (
          <div className="border border-border">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-text-subtle">
                  <th className="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                    Event
                  </th>
                  <th className="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                    Session
                  </th>
                  <th className="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                    Data
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((event) => (
                  <tr key={event.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3 font-mono text-[13px] text-text">
                      {event.name}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      <code className="text-xs">{event.session_id.slice(0, 8)}…</code>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-text-muted">
                      {event.data ? (
                        <code className="text-xs">{event.data}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-text-muted">
                      {formatTime(event.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            label="No events"
            title="No events yet"
            description={'Log events from your site with prism.logEvent("name", data) using the project key, then watch them appear here in realtime.'}
            action={
              <a
                href={`${VITE_DOCS_URL}/docs/sdks/javascript`}
                className="text-[13px] font-medium text-link transition-colors duration-150 hover:underline"
              >
                Read the SDK reference
              </a>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

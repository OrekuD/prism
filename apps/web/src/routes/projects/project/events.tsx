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
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:4321";
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
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Event</th>
                  <th className="px-4 py-2 text-left font-medium">Session</th>
                  <th className="px-4 py-2 text-left font-medium">Data</th>
                  <th className="px-4 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.map((event) => (
                  <tr key={event.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{event.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      <code className="text-xs">
                        {event.session_id.slice(0, 8)}…
                      </code>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {event.data ? (
                        <code className="text-xs">{event.data}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
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
                href={`${VITE_DOCS_URL}/reference/sdk`}
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

import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useParams } from "react-router-dom";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ProjectEvents() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectEventsQuery(slug);

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
          <p className="text-sm text-muted-foreground py-6 text-center">
            No events yet. Log events from your site with{" "}
            <code className="text-xs">prism.logEvent("name", data)</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

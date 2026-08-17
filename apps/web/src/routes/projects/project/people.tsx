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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import { usePeopleQuery, useTotalsQuery } from "@/network/queries/usePeopleQueries";
import type { PeopleResource } from "@prism-analytics/types";

/**
 * People list (task-10 §8): paginated, project-scoped, honest identity
 * columns (last-seen, sessions, events, identity links), exact external-ID
 * search, redacted trait values by default with deliberate disclosure.
 */

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function RedactedTraits({ traits }: { traits: Record<string, unknown> }) {
  const [revealed, setRevealed] = React.useState(false);
  const entries = Object.entries(traits);
  if (entries.length === 0) return <span className="text-text-subtle">—</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-[180px] truncate text-text-muted" aria-label="traits">
        {revealed
          ? entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ")
          : entries.map(([key]) => key).join(", ")}
      </span>
      <button
        type="button"
        className="text-[11px] font-medium text-link hover:underline"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? "Hide trait values" : "Reveal trait values"}
      >
        {revealed ? "hide" : "reveal"}
      </button>
    </div>
  );
}

export function ProjectPeople() {
  const { slug } = useParams<{ slug: string }>();
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const { data, isLoading, isError, refetch, isFetching } = usePeopleQuery(slug, {
    cursor: cursor ?? undefined,
    q: appliedSearch || undefined,
  });
  const totals = useTotalsQuery(slug);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>People</CardTitle>
          <CardDescription>
            Resolved analytics subjects — developer-supplied identities only.{" "}
            {totals.data
              ? `${totals.data.people} people · ${totals.data.anonymousIdentities} anonymous identities · ${totals.data.sessions} sessions · ${totals.data.events} events`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form
            className="flex max-w-sm items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setCursor(null);
              setAppliedSearch(search.trim());
            }}
          >
            <label className="sr-only" htmlFor="people-search">
              Search people by exact external ID
            </label>
            <Input
              type="search"
              id="people-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Exact external ID (no partial matches)"
              aria-describedby="people-search-hint"
            />
            <Button type="submit" size="sm">
              Search
            </Button>
            <p id="people-search-hint" className="sr-only">
              Search matches the exact developer-supplied user ID only; broad
              enumeration is intentionally not supported.
            </p>
          </form>

          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading people">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : isError ? (
            <ErrorState
              title="Could not load people"
              description="Prism could not reach the people store. Check your connection and try again."
              onRetry={() => refetch()}
            />
          ) : data && data.people.length > 0 ? (
            <div className="border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-text-subtle">
                    <th className="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Person
                    </th>
                    <th className="px-4 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Traits
                    </th>
                    <th className="px-4 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Sessions
                    </th>
                    <th className="px-4 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Events
                    </th>
                    <th className="px-4 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Identities
                    </th>
                    <th className="px-4 py-2.5 text-right font-mono text-[11px] font-medium uppercase tracking-[0.09em]">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person: PeopleResource) => (
                    <tr
                      key={person.personId}
                      className="border-b border-border last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/projects/${slug}/people/${encodeURIComponent(person.personId)}`}
                          className="font-mono text-[13px] text-link hover:underline"
                        >
                          {shortId(person.personId)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <RedactedTraits traits={person.traits} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {person.sessionCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {person.eventCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {person.identityCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                        {new Date(person.lastSeenAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              label="No people"
              title={appliedSearch ? "No matching people" : "No people yet"}
              description={
                appliedSearch
                  ? "Search matches the exact external ID only. Check the ID and try again."
                  : "People appear here after a Prism SDK calls identify() with a developer-supplied user ID."
              }
            />
          )}

          {(data?.nextCursor || cursor) && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor(null)}
                disabled={!cursor || isFetching}
              >
                Previous page
              </Button>
              {data?.nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCursor(data.nextCursor)}
                  disabled={isFetching}
                >
                  Next page
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

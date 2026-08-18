import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { PageHeader } from "@/components/public/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { axiosInstance } from "@/utils/axiosInstance";
import { useNavigate, useParams } from "react-router-dom";
import { usePersonActivityQuery, usePersonQuery } from "@/network/queries/usePeopleQueries";

/**
 * Person detail (task-10 §8): current traits (redacted by default with
 * deliberate disclosure), linked anonymous identities, and a chronological
 * event timeline; Export + Delete actions with explicit destructive
 * confirmation. Keyboard-accessible, screen-reader labeled, responsive.
 */

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

export function PersonDetail() {
  const { slug, personId, wrkSlug } = useParams<{ slug: string; personId: string; wrkSlug: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = usePersonQuery(slug, personId);
  const activity = usePersonActivityQuery(slug, personId);
  const [revealTraits, setRevealTraits] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const handleExport = async () => {
    if (!slug || !personId || exporting) return;
    setExporting(true);
    try {
      const response = await axiosInstance.get(`/projects/${slug}/people/${personId}/export`);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `person-${personId.slice(0, 8)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!slug || !personId || deleting || confirmText !== "delete") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await axiosInstance.delete(`/projects/${slug}/people/${personId}?confirm=true`);
      navigate(`/workspace/${wrkSlug}/projects/${slug}/people`);
    } catch {
      setDeleteError("Deletion failed. Try again.");
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading person">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load person"
        description="Prism could not reach the people store. Check your connection and try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={shortId(data.personId)}
        description={`First seen ${new Date(data.firstSeenAt).toLocaleString()} · Last seen ${new Date(data.lastSeenAt).toLocaleString()} · ${data.identityCount} linked identities`}
      />
      <Card>
        <CardContent className="grid gap-3">
          <section aria-labelledby="traits-heading">
            <h3 id="traits-heading" className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-subtle">
              Current traits
            </h3>
            {Object.keys(data.traits).length === 0 ? (
              <p className="text-text-subtle">No traits supplied.</p>
            ) : (
              <div className="grid gap-1">
                {Object.entries(data.traits).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4 text-[13px]">
                    <span className="font-mono">{key}</span>
                    <span className="text-text-muted">
                      {revealTraits ? JSON.stringify(value) : "•••"}
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-1 w-fit text-[12px] font-medium text-link hover:underline"
                  onClick={() => setRevealTraits((v) => !v)}
                  aria-label={revealTraits ? "Hide trait values" : "Reveal trait values"}
                >
                  {revealTraits ? "Hide values" : "Reveal values"}
                </button>
              </div>
            )}
          </section>

          <section aria-labelledby="identities-heading">
            <h3 id="identities-heading" className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-subtle">
              Linked identities
            </h3>
            <div className="grid gap-1 text-[13px]">
              {data.externalIds.map((id) => (
                <div key={`e-${id}`} className="flex items-center gap-2">
                  <span className="font-mono">{shortId(id)}</span>
                  <span className="text-[11px] text-text-subtle">external</span>
                </div>
              ))}
              {data.anonymousIds.map((id) => (
                <div key={`a-${id}`} className="flex items-center gap-2">
                  <span className="font-mono">{shortId(id)}</span>
                  <span className="text-[11px] text-text-subtle">anonymous</span>
                </div>
              ))}
              {data.externalIds.length + data.anonymousIds.length === 0 && (
                <p className="text-text-subtle">No linked identities.</p>
              )}
            </div>
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Activity</CardTitle>
          <CardDescription>Chronological event timeline for this person.</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : activity.data && activity.data.length > 0 ? (
            <ol className="grid gap-2" aria-label="Event timeline">
              {activity.data.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-[13px] last:border-0"
                >
                  <span className="font-mono">{event.name}</span>
                  <span className="text-text-muted">
                    {new Date(event.occurredAt).toLocaleString()}
                    {event.sessionId ? ` · session ${shortId(event.sessionId)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              label="No activity"
              title="No events yet"
              description="Events recorded under this person's identities will appear here."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Privacy</CardTitle>
          <CardDescription>
            Export documented analytics data for this person, or delete it permanently.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export person data"}
            </Button>
          </div>
          <div className="grid max-w-md gap-2 rounded-lg border border-border p-3">
            <p className="text-[13px] text-text-muted">
              Deleting removes this person's identity links, traits, sessions, and events
              permanently. A future identify with the same external ID starts a fresh
              person — deleted history never returns.
            </p>
            <label htmlFor="delete-confirm" className="text-[12px] text-text-subtle">
              Type <code className="font-mono">delete</code> to confirm:
            </label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="delete"
              aria-describedby="delete-confirm-hint"
            />
            <p id="delete-confirm-hint" className="sr-only">
              The destructive action requires typing the word delete exactly.
            </p>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmText !== "delete" || deleting}
            >
              {deleting ? "Deleting…" : "Delete person"}
            </Button>
            {deleteError && <p className="text-[13px] text-destructive">{deleteError}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

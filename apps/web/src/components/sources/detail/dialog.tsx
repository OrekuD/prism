import { AllowedOrigins } from "@/components/sources/detail/allowed-origins";
import { IngestionKeys } from "@/components/sources/detail/ingestion-keys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PLATFORM_LABELS, formatCount } from "@/lib/sources";
import { useActiveMember } from "@/lib/workspace";
import { useDeleteSourceMutation } from "@/network/mutations/useSourceMutations";
import { useSourceQuery } from "@/network/queries/useSourcesQuery";
import { Loader2, Trash2, X } from "@/components/ui/hugeicons";
import { useNavigate, useParams } from "react-router-dom";

export function SourceDetailDialog() {
  // Mounted under the sources/:seg dispatch route — `seg` is always a
  // source id here (known type words are routed to the Sources page).
  // Also used as a child dialog overlay: the background list stays mounted.
  const { slug, wrkSlug, seg, sourceId: sourceIdParam, type, tab } = useParams<{
    slug: string;
    wrkSlug: string;
    seg: string;
    sourceId: string;
    type: string;
    tab: string;
  }>();
  const sourceId = sourceIdParam ?? seg;
  const navigate = useNavigate();
  const base =
    type && tab
      ? `/workspace/${wrkSlug}/projects/${slug}/sources/${type}/${tab}`
      : `/workspace/${wrkSlug}/projects/${slug}/sources`;
  const { data, isLoading, isError, refetch } = useSourceQuery(slug, sourceId);
  const deleteSource = useDeleteSourceMutation(slug);
  const activeMember = useActiveMember();

  const canManage =
    activeMember?.data?.role === "owner" ||
    activeMember?.data?.role === "admin";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) navigate(base);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[800px] max-w-[1000px] gap-0 p-0 sm:max-w-[1000px] max-h-[90vh] overflow-auto"
      >
        {/* Hidden title for a11y when loading/error – real title renders when data is ready */}
        {isLoading ? (
          <div className="flex flex-col gap-4 p-6">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="sr-only">Loading source</DialogTitle>
              <DialogDescription className="sr-only">
                Loading source detail
              </DialogDescription>
            </DialogHeader>
            <Skeleton className="h-[24px] w-1/4" />
            <Skeleton className="h-[120px] w-full" />
            <Skeleton className="h-[80px] w-full" />
          </div>
        ) : isError || !data ? (
          <div className="flex flex-col gap-4 p-6">
            <DialogHeader className="gap-2 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="font-sans text-[17px] font-medium leading-snug tracking-[-0.015em] text-text">
                    Source not found
                  </DialogTitle>
                  <DialogDescription className="font-sans text-[13px] leading-[1.5] text-text-muted">
                    It may have been deleted.
                  </DialogDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  onClick={() => navigate(base)}
                  className="shrink-0"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </DialogHeader>
            <ErrorState
              title="Could not load source"
              description="It may have been deleted."
              onRetry={() => refetch()}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-6">
            <DialogHeader className="gap-2 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <DialogTitle className="font-sans text-[17px] font-medium leading-snug tracking-[-0.015em] text-text">
                    {data.name}
                  </DialogTitle>
                  <DialogDescription className="font-sans text-[13px] leading-[1.5] text-text-muted">
                    {PLATFORM_LABELS[data.platform]} source ·{" "}
                    {formatCount(data.telemetry.events)} events
                    {data.telemetry.lastReceivedAt
                      ? ` · last ${new Date(data.telemetry.lastReceivedAt).toLocaleString()}`
                      : ""}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" aria-label="Delete source">
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this source?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Its keys are revoked and telemetry stops. This can&apos;t be
                            undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleteSource.isPending}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-danger text-white hover:bg-danger/90"
                            disabled={deleteSource.isPending}
                            onClick={async (event) => {
                              event.preventDefault();
                              await deleteSource.mutateAsync(data.id);
                              navigate(base);
                            }}
                          >
                            {deleteSource.isPending ? (
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : null}
                            Delete source
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    onClick={() => navigate(base)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            {data.platform === "web" && canManage ? (
              <AllowedOrigins
                slug={slug}
                sourceId={data.id}
                initialOrigins={data.allowedOrigins}
              />
            ) : null}


            <IngestionKeys
              slug={slug}
              sourceId={data.id}
              keys={data.keys}
              canManage={canManage}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

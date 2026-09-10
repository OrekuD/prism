import { PageHeader } from "@/components/public/page-header";
import { AllowedOrigins } from "@/components/sources/detail/allowed-origins";
import { ErrorCollection } from "@/components/sources/detail/error-collection";
import { IngestionKeys } from "@/components/sources/detail/ingestion-keys";
import { SdkSetup } from "@/components/sources/detail/sdk-setup";
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
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PLATFORM_LABELS, formatCount } from "@/lib/sources";
import { useActiveMember } from "@/lib/workspace";
import { useDeleteSourceMutation } from "@/network/mutations/useSourceMutations";
import { useUpdateErrorSettingsMutation } from "@/network/mutations/useErrorSettingsMutation";
import { useSourceQuery } from "@/network/queries/useSourcesQuery";
import { useSourceErrorSettingsQuery } from "@/network/queries/useSourceErrorSettingsQuery";
import { Loader2, Trash2 } from "@/components/ui/hugeicons";
import { useNavigate, useParams } from "react-router-dom";

export function SourceDetail() {
  // Mounted under the sources/:seg dispatch route — `seg` is always a
  // source id here (known type words are routed to the Sources page).
  const { slug, wrkSlug, seg } = useParams<{
    slug: string;
    wrkSlug: string;
    seg: string;
  }>();
  const sourceId = seg;
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useSourceQuery(slug, sourceId);
  const deleteSource = useDeleteSourceMutation(slug);
  const activeMember = useActiveMember();

  // Per-source error collection config (task-15 item 440)
  const errorSettings = useSourceErrorSettingsQuery(slug, sourceId);
  const updateErrorSettings = useUpdateErrorSettingsMutation(slug, sourceId);

  const canManage =
    activeMember?.data?.role === "owner" ||
    activeMember?.data?.role === "admin";

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-[24px] w-1/4" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load source"
        description="It may have been deleted."
        onRetry={() => refetch()}
      />
    );
  }

  const endpoint = window.location.origin;
  const snippetKey =
    data.keys.find(
      (key) => key.keyType === "publishable" && key.status === "active",
    )?.value ?? "";

  return (
    <div className="flex flex-1 flex-col space-y-6">
      <PageHeader
        title={data.name}
        description={
          <>
            {PLATFORM_LABELS[data.platform]} source ·{" "}
            {formatCount(data.telemetry.events)} events
            {data.telemetry.lastReceivedAt
              ? ` · last ${new Date(data.telemetry.lastReceivedAt).toLocaleString()}`
              : ""}
          </>
        }
      >
        {canManage && (
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
                  Its keys are revoked and telemetry stops. This can't be undone.
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
                    navigate(`/workspace/${wrkSlug}/projects/${slug}/sources`);
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
        )}
      </PageHeader>

      <SdkSetup
        platform={data.platform}
        endpoint={endpoint}
        snippetKey={snippetKey}
      />

      {data.platform === "web" && canManage ? (
        <AllowedOrigins
          slug={slug}
          sourceId={data.id}
          initialOrigins={data.allowedOrigins}
        />
      ) : null}

      <ErrorCollection
        errorSettings={errorSettings}
        updateErrorSettings={updateErrorSettings}
        canManage={canManage}
      />

      <IngestionKeys
        slug={slug}
        sourceId={data.id}
        keys={data.keys}
        canManage={canManage}
      />
    </div>
  );
}

import { Frame, SectionLabel } from "@/components/public/frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SOURCE_ERROR_MODE_LABELS,
  type SourceErrorMode,
  type SourceErrorSettings,
} from "@/lib/sources";
import type { useSourceErrorSettingsQuery } from "@/network/queries/useSourceErrorSettingsQuery";
import type { useUpdateErrorSettingsMutation } from "@/network/mutations/useErrorSettingsMutation";
import React from "react";

type ErrorSettingsQueryResult = ReturnType<typeof useSourceErrorSettingsQuery>;
type UpdateErrorSettingsMutation = ReturnType<
  typeof useUpdateErrorSettingsMutation
>;

export type ErrorCollectionProps = {
  errorSettings: ErrorSettingsQueryResult;
  updateErrorSettings: UpdateErrorSettingsMutation;
  canManage: boolean;
};

export function ErrorCollection({
  errorSettings,
  updateErrorSettings,
  canManage,
}: ErrorCollectionProps) {
  const [errorDraft, setErrorDraft] =
    React.useState<SourceErrorSettings | null>(null);

  // Seed the draft whenever the server row (re)loads.
  React.useEffect(() => {
    if (errorSettings.data) setErrorDraft(errorSettings.data);
  }, [errorSettings.data]);

  const errorDirty =
    errorDraft !== null &&
    errorSettings.data !== undefined &&
    JSON.stringify({
      mode: errorDraft.mode,
      captureGlobalErrors: errorDraft.captureGlobalErrors,
      breadcrumbsEnabled: errorDraft.breadcrumbsEnabled,
      samplingRate: errorDraft.samplingRate,
      release: errorDraft.release,
    }) !==
      JSON.stringify({
        mode: errorSettings.data?.mode ?? "manual",
        captureGlobalErrors: errorSettings.data?.captureGlobalErrors ?? false,
        breadcrumbsEnabled: errorSettings.data?.breadcrumbsEnabled ?? false,
        samplingRate: errorSettings.data?.samplingRate ?? 100,
        release: errorSettings.data?.release ?? null,
      });

  return (
    <Frame className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <SectionLabel prefix={null}>Error collection</SectionLabel>
          <p className="text-[13px] text-text-muted">
            Per-source diagnostic capture. The SDK enforces its own explicit
            opt-in at setup; this configures the documented default shown in
            your install snippet.
          </p>
        </div>
        {errorSettings.isLoading ? (
          <Skeleton className="h-[28px] w-[130px]" />
        ) : (
          <Badge
            variant={
              errorSettings.data?.mode === "off" ? "outline" : "default"
            }
          >
            {errorSettings.data
              ? SOURCE_ERROR_MODE_LABELS[errorSettings.data.mode]
              : "Not configured"}
          </Badge>
        )}
      </div>

      {errorSettings.isError ? (
        <p className="mt-4 font-mono text-[12px] text-danger">
          Error collection status unavailable.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {/* Live status — real ingestion numbers, never fabricated. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12px] text-text-muted">
            <span>
              {errorSettings.data?.errorCount30d ?? 0} errors in the last 30
              days
            </span>
            <span>
              {errorSettings.data?.lastSeenErrorAt
                ? `Last error ${new Date(
                    errorSettings.data.lastSeenErrorAt,
                  ).toLocaleString()}`
                : "No errors captured yet"}
            </span>
          </div>

          {canManage ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="error-mode">Collection mode</Label>
                  <Select
                    value={errorDraft?.mode ?? "manual"}
                    onValueChange={(value) =>
                      setErrorDraft((prev) =>
                        prev ? { ...prev, mode: value as SourceErrorMode } : prev,
                      )
                    }
                  >
                    <SelectTrigger
                      id="error-mode"
                      className="h-9 w-full"
                      aria-label="Collection mode"
                    >
                      <SelectValue placeholder="Manual only" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="manual">
                        Manual only — explicit captureException
                      </SelectItem>
                      <SelectItem value="all">Manual + global handlers</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11.5px] leading-[1.45] text-text-subtle">
                    "Global handlers" installs window error + rejection listeners
                    in the SDK — an explicit privacy opt-in.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="error-sampling">Client sampling</Label>
                  <Select
                    value={String(errorDraft?.samplingRate ?? 100)}
                    onValueChange={(value) =>
                      setErrorDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              samplingRate: Number(value),
                            }
                          : prev,
                      )
                    }
                  >
                    <SelectTrigger
                      id="error-sampling"
                      className="h-9 w-full"
                      aria-label="Client sampling rate"
                    >
                      <SelectValue placeholder="100%" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100">100% — collect all</SelectItem>
                      <SelectItem value="50">50%</SelectItem>
                      <SelectItem value="25">25%</SelectItem>
                      <SelectItem value="10">10%</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11.5px] leading-[1.45] text-text-subtle">
                    Sampling is applied client-side; nothing is ever sent beyond
                    the sample you choose.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <label
                  htmlFor="capture-global-errors"
                  className="flex items-start gap-2.5 text-[13px] text-text"
                >
                  <Checkbox
                    id="capture-global-errors"
                    checked={errorDraft?.captureGlobalErrors ?? false}
                    onCheckedChange={(checked) =>
                      setErrorDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              captureGlobalErrors: checked === true,
                            }
                          : prev,
                      )
                    }
                  />
                  <span>
                    Capture unhandled errors automatically
                    <span className="block text-[11.5px] text-text-subtle">
                      Window "error" and unhandled-rejection listeners.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor="collect-error-breadcrumbs"
                  className="flex items-start gap-2.5 text-[13px] text-text"
                >
                  <Checkbox
                    id="collect-error-breadcrumbs"
                    checked={errorDraft?.breadcrumbsEnabled ?? false}
                    onCheckedChange={(checked) =>
                      setErrorDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              breadcrumbsEnabled: checked === true,
                            }
                          : prev,
                      )
                    }
                  />
                  <span>
                    Collect breadcrumbs
                    <span className="block text-[11.5px] text-text-subtle">
                      Only counts are ever surfaced — never their contents.
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="error-release">Release</Label>
                <Input
                  id="error-release"
                  value={errorDraft?.release ?? ""}
                  onChange={(event) =>
                    setErrorDraft((prev) =>
                      prev ? { ...prev, release: event.target.value } : prev,
                    )
                  }
                  placeholder="web@1.0.0"
                  className="max-w-[280px] font-mono"
                />
                <p className="text-[11.5px] leading-[1.45] text-text-subtle">
                  Release metadata stamped into the install snippet and issue
                  detail.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!errorDirty || updateErrorSettings.isPending}
                  onClick={() => {
                    if (!errorDraft) return;
                    updateErrorSettings.mutate({
                      mode: errorDraft.mode,
                      captureGlobalErrors: errorDraft.captureGlobalErrors,
                      breadcrumbsEnabled: errorDraft.breadcrumbsEnabled,
                      samplingRate: errorDraft.samplingRate,
                      release: errorDraft.release?.trim() || null,
                    });
                  }}
                >
                  {updateErrorSettings.isPending ? "Saving…" : "Save settings"}
                </Button>
                {updateErrorSettings.isError ? (
                  <span className="font-mono text-[11px] text-danger">
                    Could not save — try again.
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-text-subtle">
              Owner or admin can change error collection settings.
            </p>
          )}
        </div>
      )}
    </Frame>
  );
}

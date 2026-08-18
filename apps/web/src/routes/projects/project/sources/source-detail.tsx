import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Frame, SectionLabel } from "@/components/public/frame";
import { PageHeader } from "@/components/public/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSourceQuery } from "@/network/queries/useSourcesQuery";
import {
  useCreateKeyMutation,
  useDeleteSourceMutation,
  useRevealKeyMutation,
  useRevokeKeyMutation,
  useUpdateSourceMutation,
} from "@/network/mutations/useSourceMutations";
import { useActiveMember } from "@/lib/workspace";
import { Loader2, Plus, RefreshCw, Trash2, Eye, EyeOff, TriangleAlert, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const PLATFORM_LABELS: Record<string, string> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
  "react-native": "React Native",
  server: "Server API",
};

/** Valid http(s) origin, or a wildcard-subdomain origin (https://*.example.com). */
function isValidOrigin(origin: string): boolean {
  const value = origin.trim();
  if (!value) return true; // empty lines are ignored
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return /^https?:\/\/\*\.[^\s/]+$/.test(value);
  }
}

/** Keys are shown once at creation — list rows render a masked preview. */
function maskKey(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}${String.fromCharCode(0x2022).repeat(8)}${value.slice(-4)}`;
}

/** Compact count formatting — 2K, 2M, … */
function formatCount(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** SDK snippets carry ONLY the source's key — never a project or
 * organization id. */
function sdkSnippet(
  platform: string,
  key: string,
  endpoint: string,
): string {
  if (platform === "server") {
    return `import { PrismClient } from "@prism-analytics/core";

const prism = new PrismClient({
  sourceKey: "${key}", // secret server key — keep it out of client bundles
  endpoint: "${endpoint}",
});

await prism.track("order_completed", { value: 129.0 });`;
  }
  const packageName =
    platform === "web"
      ? "@prism-analytics/browser"
      : platform === "react-native"
        ? "@prism-analytics/react-native"
        : platform === "ios"
          ? "@prism-analytics/ios"
          : "@prism-analytics/android";
  return `import { createBrowserClient } from "${packageName}";

const prism = await createBrowserClient({
  sourceKey: "${key}", // publishable key — safe to embed in the client
  endpoint: "${endpoint}",
});

await prism.track("page_viewed", { url: window.location.href });`;
}

export function SourceDetail() {
  const { slug, sourceId, wrkSlug } = useParams<{ slug: string; sourceId: string; wrkSlug: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useSourceQuery(slug, sourceId);
  const createKey = useCreateKeyMutation(slug);
  const revokeKey = useRevokeKeyMutation(slug);
  const revealKey = useRevealKeyMutation(slug);
  const updateSource = useUpdateSourceMutation(slug);
  const deleteSource = useDeleteSourceMutation(slug);
  const activeMember = useActiveMember();
  const [newKeyOpen, setNewKeyOpen] = React.useState(false);
  const [newKeyName, setNewKeyName] = React.useState("");
  const [rotationKey, setRotationKey] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [revealedValues, setRevealedValues] = React.useState<Record<string, string>>({});
  const [origins, setOrigins] = React.useState<string[]>([]);
  const [originInput, setOriginInput] = React.useState("");

  // Keep the origins editor in sync once the source loads (and after save).
  React.useEffect(() => {
    if (data) setOrigins(data.allowedOrigins);
  }, [data?.id]);

  const canManage =
    activeMember?.data?.role === "owner" || activeMember?.data?.role === "admin";

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
      <ErrorState title="Could not load source" description="It may have been deleted." onRetry={() => refetch()} />
    );
  }

  const endpoint = `${window.location.origin}/api/v2/ingest`;
  const activeKeys = data.keys.filter((key) => key.status === "active");
  const snippetKey =
    data.keys.find((key) => key.keyType === "publishable" && key.status === "active")
      ?.value ?? "";

  const originInvalid =
    originInput.trim() !== "" && !isValidOrigin(originInput);

  // Add/remove persist immediately — there is no separate save step.
  async function addOrigin() {
    if (!data) return;
    const value = originInput.trim();
    if (!value || originInvalid) return;
    const next = origins.includes(value) ? origins : [...origins, value];
    setOrigins(next);
    setOriginInput("");
    await updateSource.mutateAsync({
      sourceId: data.id,
      allowedOrigins: next,
    });
  }

  function removeOrigin(origin: string) {
    if (!data) return;
    const next = origins.filter((entry) => entry !== origin);
    setOrigins(next);
    void updateSource.mutateAsync({
      sourceId: data.id,
      allowedOrigins: next,
    });
  }

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
                    Its keys are revoked and telemetry stops. This can't be
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

      <Frame className="p-6">
        <SectionLabel>SDK Setup</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          The snippet shows a placeholder — the source's{" "}
          {data.platform === "server" ? "secret" : "publishable"} key is
          shown once at creation.
        </p>
        <div className="mt-4">
          {snippetKey ? (
            <div className="space-y-2">
              <pre className="overflow-x-auto rounded-[2px] border border-border bg-surface-raised p-3 text-xs leading-relaxed">
                {sdkSnippet(
                  data.platform,
                  data.platform === "server"
                    ? "ssk_YOUR_SOURCE_KEY"
                    : "psk_YOUR_SOURCE_KEY",
                  endpoint,
                )}
              </pre>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Badge variant="outline">{PLATFORM_LABELS[data.platform]}</Badge>
                <span>
                  {data.platform === "web"
                    ? "Publishable key — origin-policed by this project's allowed origins."
                    : data.platform === "server"
                      ? "Secret key — never appears in client bundles."
                      : "Publishable key — telemetry-write-only."}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-text-muted">
              No active publishable key — create one to generate the setup
              snippet.
            </p>
          )}
        </div>
      </Frame>

      {data.platform === "web" && canManage ? (
        <Frame className="p-6">
          <SectionLabel>Allowed Origins</SectionLabel>
          <p className="mt-1.5 text-[13px] text-text-muted">
            Only these origins may send telemetry with this source's
            publishable key. Adding or removing one saves immediately.
          </p>
          <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="relative flex-1">
                  <Input
                    value={originInput}
                    onChange={(event) => setOriginInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addOrigin();
                      }
                    }}
                    placeholder="https://app.example.com"
                    className={cn(
                      "w-full pr-9",
                      originInvalid &&
                        "border-danger focus-visible:ring-danger/30",
                    )}
                  />
                  {originInvalid ? (
                    <TriangleAlert
                      className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-danger"
                      aria-label="Invalid origin"
                    />
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addOrigin}
                  disabled={originInvalid || !originInput.trim()}
                >
                  Add
                </Button>
              </div>
              {originInvalid ? (
                <p className="text-xs text-danger">
                  Must be a valid http(s) origin, e.g. https://app.example.com.
                </p>
              ) : null}
              <ul className="space-y-1.5">
                {origins.length === 0 ? (
                  <li className="text-[13px] text-text-muted">
                    No allowed origins yet.
                  </li>
                ) : (
                  origins.map((origin) => (
                    <li
                      key={origin}
                      className="flex items-center justify-between gap-2 rounded-[2px] border border-border bg-surface px-3 py-2"
                    >
                      <code className="truncate font-mono text-[12px] text-text">
                        {origin}
                      </code>
                      <button
                        type="button"
                        onClick={() => removeOrigin(origin)}
                        aria-label={`Remove ${origin}`}
                        className="shrink-0 text-text-subtle transition-colors hover:text-danger"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </Frame>
        ) : null}

      <Frame className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <SectionLabel>Ingestion Keys</SectionLabel>
            <p className="text-[13px] text-text-muted">
              Revoking a key never affects another source's installation.
            </p>
          </div>
          {canManage ? (
            <Dialog open={newKeyOpen} onOpenChange={setNewKeyOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="size-3.5" /> New key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a new ingestion key</DialogTitle>
                  <DialogDescription>
                    Multiple active keys are supported for safe rotation. The
                    new key is shown once.
                  </DialogDescription>
                </DialogHeader>
                {rotationKey ? (
                  <div className="space-y-3">
                    <Label>New key (shown once)</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded border p-2 text-xs">{rotationKey}</code>
                      <CopyButton value={rotationKey} />
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button onClick={() => { setRotationKey(null); setNewKeyName(""); }}>
                          Done
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </div>
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!newKeyName.trim()) return;
                      const result = await createKey.mutateAsync({
                        sourceId: data.id,
                        name: newKeyName.trim(),
                      });
                      setRotationKey(result.value);
                      setNewKeyName("");
                    }}
                  >
                    <div className="space-y-2">
                      <Label>Key name</Label>
                      <Input
                        value={newKeyName}
                        onChange={(event) => setNewKeyName(event.target.value)}
                        placeholder="2026 rotation"
                      />
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button type="submit" disabled={createKey.isPending}>
                        {createKey.isPending ? <Loader2 className="size-4 animate-spin" /> : "Create key"}
                      </Button>
                    </DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
        <div className="mt-4 space-y-2">
          {data.keys.length === 0 ? (
            <p className="text-[13px] text-text-muted">No keys yet.</p>
          ) : (
            data.keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-[2px] border border-border bg-surface p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {key.name}
                    </span>
                    <span
                      className={cn(
                        "border px-[5px] py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]",
                        key.status === "active"
                          ? "border-success/60 text-success"
                          : "border-border-strong text-text-subtle",
                      )}
                    >
                      {key.status}
                    </span>
                  </div>
                  <code className="block truncate text-xs text-text-muted">
                    {revealed[key.id]
                      ? (revealedValues[key.id] ?? key.value)
                      : key.keyType === "secret"
                        ? key.value // the server already masks secret values
                        : maskKey(key.value)}
                  </code>
                  <p className="text-[11px] text-text-subtle">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt ? ` · last used ${new Date(key.lastUsedAt).toLocaleString()}` : " · never used"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {key.keyType === "publishable" && key.status === "active" ? (
                    <CopyButton value={key.value} />
                  ) : null}
                  {key.keyType === "secret" && key.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (revealed[key.id]) {
                          setRevealed((prev) => ({ ...prev, [key.id]: false }));
                          return;
                        }
                        const result = await revealKey.mutateAsync({
                          sourceId: data.id,
                          keyId: key.id,
                        });
                        setRevealedValues((prev) => ({
                          ...prev,
                          [key.id]: result.value,
                        }));
                        setRevealed((prev) => ({ ...prev, [key.id]: true }));
                        toast.success("Secret key revealed");
                        await navigator.clipboard.writeText(result.value).catch(() => undefined);
                      }}
                    >
                      {revealed[key.id] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  ) : null}
                  {canManage && key.status === "active" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <RefreshCw className="size-3.5" /> Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Revoke key “{key.name}”?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Existing installs using this key stop sending.
                            This can't be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-danger text-white hover:bg-danger/90"
                            onClick={async (event) => {
                              event.preventDefault();
                              await revokeKey.mutateAsync({
                                sourceId: data.id,
                                keyId: key.id,
                              });
                            }}
                          >
                            Revoke key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Frame>
    </div>
  );
}

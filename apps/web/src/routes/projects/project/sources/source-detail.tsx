import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
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
import { Copy, Loader2, Plus, RefreshCw, Trash2, Eye, EyeOff } from "lucide-react";
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

const PLATFORM_LABELS: Record<string, string> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
  "react-native": "React Native",
  server: "Server API",
};

/** SDK snippets carry ONLY the source's key — never a project or
 * organization id. */
function sdkSnippet(
  platform: string,
  key: string,
  endpoint: string,
): string {
  if (platform === "server") {
    return `import { PrismClient } from "@prism/core";

const prism = new PrismClient({
  sourceKey: "${key}", // secret server key — keep it out of client bundles
  endpoint: "${endpoint}",
});

await prism.track("order_completed", { value: 129.0 });`;
  }
  const packageName =
    platform === "web"
      ? "@prism/browser"
      : platform === "react-native"
        ? "@prism/react-native"
        : platform === "ios"
          ? "@prism/ios"
          : "@prism/android";
  return `import { createBrowserClient } from "${packageName}";

const prism = await createBrowserClient({
  sourceKey: "${key}", // publishable key — safe to embed in the client
  endpoint: "${endpoint}",
});

await prism.track("page_viewed", { url: window.location.href });`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy");
        }
      }}
    >
      <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function SourceDetail() {
  const { slug, sourceId } = useParams<{ slug: string; sourceId: string }>();
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
  const [origins, setOrigins] = React.useState<string>("");

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

  return (
    <div className="flex flex-1 flex-col py-4 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{data.name}</h2>
          <p className="text-sm text-muted-foreground">
            {PLATFORM_LABELS[data.platform]} source ·{" "}
            {data.telemetry.events.toLocaleString()} events
            {data.telemetry.lastReceivedAt
              ? ` · last ${new Date(data.telemetry.lastReceivedAt).toLocaleString()}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Dialog open={newKeyOpen} onOpenChange={setNewKeyOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New Key
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
          )}
          {canManage && (
            <Button
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete this source? Its keys are revoked and telemetry stops.")) return;
                await deleteSource.mutateAsync(data.id);
                navigate(`/projects/${slug}/sources`);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SDK Setup</CardTitle>
          <CardDescription>
            The snippet includes only this source's{" "}
            {data.platform === "server" ? "secret" : "publishable"} key — never a
            project or workspace id.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snippetKey ? (
            <div className="space-y-2">
              <pre className="overflow-x-auto rounded border bg-muted p-3 text-xs leading-relaxed">
                {sdkSnippet(data.platform, snippetKey, endpoint)}
              </pre>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              No active publishable key — create one to generate the setup snippet.
            </p>
          )}
        </CardContent>
      </Card>

      {data.platform === "web" && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Allowed Origins</CardTitle>
            <CardDescription>
              Only these origins may send telemetry with this source's publishable
              key (one per line).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = origins
                  .split("\n")
                  .map((entry) => entry.trim())
                  .filter(Boolean);
                await updateSource.mutateAsync({ sourceId: data.id, allowedOrigins: parsed });
              }}
            >
              <Input
                className="flex-1"
                defaultValue={data.allowedOrigins.join("\n")}
                onChange={(event) => setOrigins(event.target.value)}
                placeholder={"https://app.example.com"}
              />
              <Button type="submit" disabled={updateSource.isPending}>Save</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingestion Keys</CardTitle>
          <CardDescription>
            Revoking a key never affects another source's installation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            data.keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded border p-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{key.name}</span>
                    <Badge variant={key.status === "active" ? "default" : "outline"}>
                      {key.status}
                    </Badge>
                    <Badge variant="secondary">{key.keyType}</Badge>
                  </div>
                  <code className="block truncate text-xs text-muted-foreground">
                    {key.keyType === "secret" && !revealed[key.id]
                      ? key.value
                      : key.value}
                  </code>
                  <p className="text-[11px] text-muted-foreground">
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
                        setRevealed((prev) => ({ ...prev, [key.id]: true }));
                        toast.success("Secret key revealed");
                        await navigator.clipboard.writeText(result.value).catch(() => undefined);
                      }}
                    >
                      {revealed[key.id] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  ) : null}
                  {canManage && key.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!window.confirm(`Revoke key "${key.name}"? Existing installs using it stop sending.`)) return;
                        await revokeKey.mutateAsync({ sourceId: data.id, keyId: key.id });
                      }}
                    >
                      <RefreshCw className="size-3.5" /> Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

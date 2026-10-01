import { Frame, SectionLabel } from "@/components/public/frame";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskKey } from "@/lib/sources";
import { cn } from "@/lib/utils";
import {
  useCreateKeyMutation,
  useRevealKeyMutation,
  useRevokeKeyMutation,
} from "@/network/mutations/useSourceMutations";
import type { SourceKeyResource } from "@/network/queries/useSourcesQuery";
import { Eye, EyeOff, Loader2, Plus, RefreshCw } from "@/components/ui/hugeicons";
import React from "react";
import { toast } from "sonner";

export type IngestionKeysProps = {
  slug: string | undefined;
  sourceId: string;
  keys: SourceKeyResource[];
  canManage: boolean;
};

export function IngestionKeys({
  slug,
  sourceId,
  keys,
  canManage,
}: IngestionKeysProps) {
  const createKey = useCreateKeyMutation(slug);
  const revokeKey = useRevokeKeyMutation(slug);
  const revealKey = useRevealKeyMutation(slug);

  const [newKeyOpen, setNewKeyOpen] = React.useState(false);
  const [newKeyName, setNewKeyName] = React.useState("");
  const [rotationKey, setRotationKey] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [revealedValues, setRevealedValues] = React.useState<
    Record<string, string>
  >({});

  return (
    <Frame className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <SectionLabel prefix={null}>Ingestion Keys</SectionLabel>
          <p className="text-[13px] text-text-muted">
            Keys are scoped to this source. Revoking here doesn't affect other sources.
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
                  Multiple active keys are supported for safe rotation.
                </DialogDescription>
              </DialogHeader>
              {rotationKey ? (
                <div className="space-y-3">
                  <Label>New key</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded border p-2 text-xs">
                      {rotationKey}
                    </code>
                    <CopyButton value={rotationKey} />
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button
                        onClick={() => {
                          setRotationKey(null);
                          setNewKeyName("");
                        }}
                      >
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
                      sourceId,
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
                      <Button type="button" variant="outline">
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button type="submit" disabled={createKey.isPending || !newKeyName.trim()}>
                      {createKey.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Create key"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
      <div className="mt-4 space-y-2">
        {keys.length === 0 ? (
          <p className="text-[13px] text-text-muted">No keys yet.</p>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-[12px] border border-border bg-surface p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">
                    {key.name}
                  </span>
                  <span
                    className={cn(
                      "border rounded-full px-[8px] py-0.5 text-[10px] font-medium tracking-normal",
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
                  {key.lastUsedAt
                    ? ` · last used ${new Date(key.lastUsedAt).toLocaleString()}`
                    : " · never used"}
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
                        sourceId,
                        keyId: key.id,
                      });
                      setRevealedValues((prev) => ({
                        ...prev,
                        [key.id]: result.value,
                      }));
                      setRevealed((prev) => ({ ...prev, [key.id]: true }));
                      toast.success("Secret key revealed");
                      await navigator.clipboard
                        .writeText(result.value)
                        .catch(() => undefined);
                    }}
                  >
                    {revealed[key.id] ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
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
                          Existing installs using this key stop sending. This
                          can't be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
                          disabled={revokeKey.isPending}
                          onClick={async (event) => {
                            event.preventDefault();
                            await revokeKey.mutateAsync({
                              sourceId,
                              keyId: key.id,
                            });
                          }}
                        >
                          {revokeKey.isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
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
  );
}

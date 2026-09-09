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
import { CreateSourceDialog } from "@/components/sources/create-source-dialog";
import {
  maskKey,
  PLATFORM_LABELS,
  sourceSnippetPlatform,
  sourceTypeLabel,
  timeAgo,
} from "@/lib/sources";
import {
  useCreateKeyMutation,
  useRevokeKeyMutation,
} from "@/network/mutations/useSourceMutations";
import type { SourceResource } from "@/network/queries/useSourcesQuery";
import { Ban, ChevronDown, KeyRound, Loader2, Plus } from "@/components/ui/lucide-icons";
import React from "react";
import { Link } from "react-router-dom";

function CreateKeyButton({
  slug,
  sourceId,
  size = "xs",
}: {
  slug: string;
  sourceId: string;
  size?: "xs" | "sm" | "default";
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shownKey, setShownKey] = React.useState<string | null>(null);
  const createKey = useCreateKeyMutation(slug);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <Plus className="size-3" /> New key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new ingestion key</DialogTitle>
          <DialogDescription>
            Multiple active keys are supported for safe rotation.
          </DialogDescription>
        </DialogHeader>
        {shownKey ? (
          <div className="space-y-3">
            <Label>New key</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded border p-2 text-xs">
                {shownKey}
              </code>
              <CopyButton value={shownKey} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  onClick={() => {
                    setShownKey(null);
                    setName("");
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
              if (!name.trim()) return;
              const result = await createKey.mutateAsync({
                sourceId,
                name: name.trim(),
              });
              setShownKey(result.value);
              setName("");
            }}
          >
            <div className="space-y-2">
              <Label>Key name</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="2026 rotation"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={createKey.isPending || !name.trim()}>
                {createKey.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyButton({
  slug,
  sourceId,
  keyId,
  name,
}: {
  slug: string;
  sourceId: string;
  keyId: string;
  name: string;
}) {
  const revokeKey = useRevokeKeyMutation(slug);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Revoke ${name}`}
          title={`Revoke ${name}`}
        >
          <Ban className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke key “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Existing installs using this key stop sending. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revokeKey.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
            disabled={revokeKey.isPending}
            onClick={async (event) => {
              event.preventDefault();
              await revokeKey.mutateAsync({ sourceId, keyId });
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
  );
}

export function SourceKeys({
  sources,
  type,
  wrkSlug,
  slug,
  canManage,
}: {
  sources: SourceResource[];
  type: string;
  wrkSlug: string;
  slug: string;
  canManage: boolean;
}) {
  const label = sourceTypeLabel(type);
  const sourcePath = (id: string) =>
    `/workspace/${wrkSlug}/projects/${slug}/sources/${type}/keys/${id}`;
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  return (
    <div>
      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-[16px] p-6 text-center">
          <KeyRound
            className="size-[22px] text-text-subtle"
            aria-hidden="true"
          />
          <p className="font-mono text-[13px] text-text-muted">
            No keys for this source type.
          </p>
          <span className="text-[12px] text-text-subtle">
            {canManage
              ? `Create a ${label} source to generate its first key.`
              : "An owner or admin can create a source."}
          </span>
          {canManage ? (
            <div className="mt-1">
              <CreateSourceDialog
                slug={slug}
                initialPlatform={sourceSnippetPlatform(type)}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[16px] border border-border">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {sources.map((source, idx) => {
                const isOpen = expanded[source.id] ?? true;
                return (
                  <React.Fragment key={source.id}>
                    <tr
                      className={
                        idx === 0
                          ? "bg-canvas-subtle"
                          : "border-t border-border bg-canvas-subtle"
                      }
                    >
                      <td colSpan={5} className="px-3.5 py-2.5">
                        <span className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [source.id]: !(prev[source.id] ?? true),
                              }))
                            }
                            className="flex items-center gap-2 text-left"
                            aria-expanded={isOpen}
                            aria-controls={`keys-${source.id}`}
                          >
                            <span className="grid size-4 place-items-center shrink-0">
                              <ChevronDown
                                className={`size-3.5 text-text-subtle transition-transform duration-150 ${isOpen ? "" : "-rotate-90"}`}
                                aria-hidden="true"
                              />
                            </span>
                            <Link
                              to={sourcePath(source.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[13px] font-medium text-link hover:underline"
                            >
                              {source.name}
                            </Link>
                            <span className="font-mono text-[11px] text-text-muted">
                              {source.keys.length}{" "}
                              {source.keys.length === 1 ? "key" : "keys"}
                            </span>
                          </button>
                          {canManage ? (
                            <span
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="presentation"
                            >
                              <CreateKeyButton
                                slug={slug}
                                sourceId={source.id}
                                size="xs"
                              />
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {isOpen ? (
                      source.keys.length === 0 ? (
                        <tr className="border-t border-border">
                          <td
                            colSpan={5}
                            className="px-3.5 py-3 pl-6 text-[13px] italic text-text-subtle"
                          >
                            No keys for this source.
                          </td>
                        </tr>
                      ) : (
                        <>
                          <tr className="border-t border-border bg-canvas-subtle/50 text-text-muted">
                            <th className="px-3.5 py-2 pl-6 text-left text-[13px] font-medium tracking-normal">
                              Name
                            </th>
                            <th className="px-3.5 py-2 text-left text-[13px] font-medium tracking-normal">
                              Key
                            </th>
                            <th className="px-3.5 py-2 text-left text-[13px] font-medium tracking-normal">
                              Created
                            </th>
                            <th className="px-3.5 py-2 text-left text-[13px] font-medium tracking-normal">
                              Last used
                            </th>
                            <th className="px-3.5 py-2 text-right text-[13px] font-medium tracking-normal">
                              Actions
                            </th>
                          </tr>
                          {source.keys.map((key) => (
                            <tr
                              key={key.id}
                              id={`keys-${source.id}`}
                              className="group border-t border-border hover:bg-surface-hover/40"
                            >
                              <td className="border-l-2 border-l-transparent px-3.5 py-2.5 pl-6 text-text group-hover:border-l-border-strong">
                                {key.name}
                              </td>
                              <td className="px-3.5 py-2.5">
                                <code className="font-mono text-[12px] text-text-muted">
                                  {maskKey(key.value)}
                                </code>
                              </td>
                              <td className="px-3.5 py-2.5 text-text-muted">
                                {new Date(key.createdAt).toLocaleDateString()}
                              </td>
                              <td className="px-3.5 py-2.5 text-text-muted">
                                {key.lastUsedAt
                                  ? timeAgo(new Date(key.lastUsedAt).getTime())
                                  : "never"}
                              </td>
                              <td className="px-3.5 py-2.5">
                                <span className="flex items-center justify-end gap-1">
                                  <CopyButton value={key.value} iconOnly />
                                  {canManage && key.status === "active" ? (
                                    <RevokeKeyButton
                                      slug={slug}
                                      sourceId={source.id}
                                      keyId={key.id}
                                      name={key.name}
                                    />
                                  ) : null}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </>
                      )
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

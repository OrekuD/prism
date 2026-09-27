import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORM_LABELS } from "@/lib/sources";
import { useActiveMember } from "@/lib/workspace";
import { CREATABLE_PLATFORMS } from "@/lib/workspace";
import { useCreateSourceMutation } from "@/network/mutations/useSourceMutations";
import { Loader2, Plus } from "@/components/ui/hugeicons";
import React from "react";

export function CreateSourceDialog({
  slug,
  initialPlatform = "web",
}: {
  slug: string;
  initialPlatform?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState<string>(initialPlatform);
  const [created, setCreated] = React.useState<{
    key: string | null;
    secret: boolean;
  } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const createMutation = useCreateSourceMutation(slug);
  const admin = useActiveMember();

  const canManage =
    admin?.data?.role === "owner" || admin?.data?.role === "admin";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || createMutation.isPending) return;
    setFailed(false);
    try {
      const source = await createMutation.mutateAsync({
        name: name.trim(),
        platform,
      });
      setCreated({
        key: source.initialKey ?? null,
        secret: source.platform === "server",
      });
      createMutation.reset();
    } catch {
      setFailed(true);
    }
  }

  function onOpenChange(next: boolean) {
    if (!next && createMutation.isPending) return;
    setOpen(next);
    if (!next) {
      setCreated(null);
      setName("");
      setPlatform(initialPlatform);
      setFailed(false);
      createMutation.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={!canManage}
          title={canManage ? undefined : "Members cannot create sources"}
        >
          <Plus className="size-4" /> New source
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {created ? "Source created" : "Create source"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? created.secret
                ? "Save your secret key now. It won't be shown again. Keep it on your server, never in a browser or mobile app."
                : "Copy this publishable key to configure your SDK."
              : "Create a new source for this project."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-4">
            {created.key ? (
              <div className="space-y-3">
                <div className="text-sm font-medium">
                  {created.secret ? "Secret key" : "Publishable key"}
                </div>
                <code className="block select-all break-all rounded-lg border border-border bg-surface p-3 text-xs">
                  {created.key}
                </code>
                <CopyButton value={created.key} />
              </div>
            ) : (
              <p role="alert" className="text-sm text-text-muted">
                The source was created, but its initial key wasn't returned.
                Create a new key from the source's Keys section.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-source-name">Name</Label>
              <Input
                id="new-source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Marketing site"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-source-platform">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger id="new-source-platform" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="w-full min-w-[--radix-select-trigger-width]">
                  {CREATABLE_PLATFORMS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PLATFORM_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {failed ? (
              <p role="alert" className="text-sm text-danger">
                Could not create the source. Please try again.
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={createMutation.isPending || !name.trim()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
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
import { Loader2, Plus } from "@/components/ui/lucide-icons";
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
  const createMutation = useCreateSourceMutation(slug);
  const admin = useActiveMember();

  const canManage =
    admin?.data?.role === "owner" || admin?.data?.role === "admin";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await createMutation.mutateAsync({ name: name.trim(), platform });
    setOpen(false);
    setName("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <DialogTitle>Create source</DialogTitle>
          <DialogDescription>
            Create a new source for this project.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Marketing site"
            />
          </div>
          <div className="space-y-2">
            <Label>Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-full">
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
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import React from "react";
import { CheckIcon, PlusCircledIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "../ui/skeleton";
import { getInitials } from "@/utils/getInitials";
import {
  useActiveWorkspace,
  useCurrentWorkspace,
  useWorkspaces,
  workspaceActions,
} from "@/lib/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/**
 * Task 13 workspace switcher: built on Better Auth's active-organization
 * session state. Switching persists through the plugin's set-active
 * endpoint and survives a normal session refresh.
 */
export function WorkspaceSwitcher() {
  const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] =
    React.useState(false);
  const { data: workspaces, isPending } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const { workspace } = useCurrentWorkspace();

  const list = (workspaces ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    logo?: string | null;
  }>;

  const activeWorkspace = (active as { id: string; name: string } | null) ?? workspace;

  if (isPending && !workspace) {
    return <Skeleton className="h-9 w-[180px]" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-haspopup="menu"
          aria-expanded={false}
          className="justify-between w-[200px]"
        >
          <span className="flex items-center gap-2 truncate">
            {activeWorkspace ? (
              <>
                <Avatar className="size-5">
                  <AvatarFallback className="text-[10px]">
                    {getInitials(activeWorkspace.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{activeWorkspace.name}</span>
              </>
            ) : (
              "Select workspace"
            )}
          </span>
          <CaretSortIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {list.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onSelect={async () => {
              if (entry.id !== activeWorkspace?.id) {
                await workspaceActions.setActive(entry.id);
              }
            }}
          >
            {entry.name}
            <CheckIcon
              className={cn(
                "ml-auto size-4",
                activeWorkspace?.id === entry.id ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setShowNewWorkspaceDialog(true)}>
          <PlusCircledIcon className="mr-2 size-4" />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
      <CreateWorkspaceDialog
        open={showNewWorkspaceDialog}
        onOpenChange={setShowNewWorkspaceDialog}
      />
    </DropdownMenu>
  );
}

function CaretSortIcon() {
  return <span aria-hidden="true" className="text-muted-foreground">▾</span>;
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            A workspace is your team&apos;s tenant — projects, sources, and
            members live inside it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            try {
              const created = await workspaceActions.create(name.trim());
              const id = (created as { id?: string })?.id;
              if (id) await workspaceActions.setActive(id);
              toast.success("Workspace created");
              setName("");
              onOpenChange(false);
            } catch (error) {
              const message = String((error as { message?: unknown })?.message ?? error);
              toast.error(
                message.includes("ALREADY_EXISTS")
                  ? "A workspace with that name already exists."
                  : "Could not create the workspace.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

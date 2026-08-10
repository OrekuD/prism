import type React from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { LoadingSpinner } from "./loading-spinner";
import { useDeleteTeamMutation } from "@/network/mutations/useDeleteTeamMutation";

type Props = {
  deleteTeamId: string;
  setDeleteTeamId: React.Dispatch<React.SetStateAction<string>>;
};

export function DeleteTeam({ deleteTeamId, setDeleteTeamId }: Props) {
  const deleteTeamMutation = useDeleteTeamMutation();

  return (
    <Dialog
      open={Boolean(deleteTeamId)}
      onOpenChange={() => setDeleteTeamId("")}
    >
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Delete Team</DialogTitle>
          <DialogDescription>
            All projects associated with this team will also be deleted. This
            action is irreversible.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={deleteTeamMutation.isPending}
            onClick={() => {
              setDeleteTeamId("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deleteTeamMutation.isPending}
            onClick={async () => {
              const response = await deleteTeamMutation.mutateAsync({
                teamId: deleteTeamId,
              });
              if (response?.message) {
                setDeleteTeamId("");
              }
            }}
          >
            {deleteTeamMutation.isPending ? <LoadingSpinner /> : "Delete Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

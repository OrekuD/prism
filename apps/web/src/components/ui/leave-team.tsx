import React from "react";
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
import { useLeaveTeamMutation } from "@/network/mutations/useLeaveTeamMutation";

type Props = {
  leaveTeamId: string;
  setLeaveTeamId: React.Dispatch<React.SetStateAction<string>>;
};

export function LeaveTeam({
  leaveTeamId: deleteTeamId,
  setLeaveTeamId: setDeleteTeamId,
}: Props) {
  const leaveTeamMutation = useLeaveTeamMutation();

  return (
    <Dialog
      open={Boolean(deleteTeamId)}
      onOpenChange={() => setDeleteTeamId("")}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Team</DialogTitle>
          <DialogDescription>
            You will lose access to this team and all projects associated to
            this team.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDeleteTeamId("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={leaveTeamMutation.isPending}
            onClick={async () => {
              const response = await leaveTeamMutation.mutateAsync({
                teamId: deleteTeamId,
              });
              if (response?.message) {
                setDeleteTeamId("");
              }
            }}
          >
            {leaveTeamMutation.isPending ? <LoadingSpinner /> : "Leave Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

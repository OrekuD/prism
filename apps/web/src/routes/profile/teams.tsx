import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserStore } from "@/store/userStore";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateTeam } from "@/components/ui/create-team";
import { useDeleteTeamMutation } from "@/network/mutations/useDeleteTeamMutation";
import { InviteTeamMembers } from "@/components/ui/invite-team-members";
import useSearch from "@/hooks/useSearch";
import { TeamResource } from "@prism/types";
import Fuse from "fuse.js";
import { TeamCard } from "@/components/ui/team-card";
import { DeleteTeam } from "@/components/ui/delete-team";
import { LeaveTeam } from "@/components/ui/leave-team";
import { ValueNoneIcon } from "@radix-ui/react-icons";

export function AccountTeams() {
  const { data, isLoading } = useTeamsQuery();
  const { user } = useUserStore();

  const [showCreateTeamDialog, setShowCreateTeamDialog] = React.useState(false);

  const [deleteTeamId, setDeleteTeamId] = React.useState("");
  const [leaveTeamId, setLeaveTeamId] = React.useState("");

  const [inviteTeamMembersId, setInviteTeamMembersId] = React.useState("");

  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResponse, setSearchResponse] = React.useState<
    Array<TeamResource>
  >([]);

  const fuse = new Fuse(data || [], {
    keys: ["name"],
  });

  useSearch(
    searchQuery,
    () => {},
    () => {
      setSearchResponse(fuse.search(searchQuery).map(({ item }) => item));
    },
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Teams</CardTitle>
            <CardDescription className="mt-2">
              Manage the teams you belong to.
            </CardDescription>
          </div>
          <CreateTeam
            open={showCreateTeamDialog}
            setOpen={setShowCreateTeamDialog}
          >
            <Button>Create Team</Button>
          </CreateTeam>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-3 size-4 text-muted-foreground" />
            <Input
              placeholder="Search teams..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {Boolean(searchQuery.trim()) ? (
              <button
                className="absolute right-2.5 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-full bg-muted"
                onClick={() => setSearchQuery("")}
              >
                <X className="size-4 text-primary" />
              </button>
            ) : null}
          </div>
          {isLoading ? (
            <div className="rounded-md border flex items-center gap-3 px-2 h-16">
              <Skeleton className="ml-2 size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-32 rounded-sm" />
                <Skeleton className="h-3 w-24 rounded-sm" />
              </div>
            </div>
          ) : (
            <>
              {searchQuery.trim().length > 1 ? (
                <>
                  {searchResponse.length > 0 ? (
                    <div className="space-y-3">
                      {searchResponse.map((team) => {
                        return (
                          <TeamCard
                            team={team}
                            setDeleteTeamId={setDeleteTeamId}
                            setLeaveTeamId={setLeaveTeamId}
                            setInviteTeamMembersId={setInviteTeamMembersId}
                            key={team.id}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid place-items-center text-center py-8 gap-3 text-sm font-medium">
                      <ValueNoneIcon className="size-10" />
                      No teams found
                    </div>
                  )}
                </>
              ) : (
                <>
                  {data ? (
                    <div className="space-y-3">
                      {data.map((team) => {
                        return (
                          <TeamCard
                            team={team}
                            setDeleteTeamId={setDeleteTeamId}
                            setLeaveTeamId={setLeaveTeamId}
                            setInviteTeamMembersId={setInviteTeamMembersId}
                            key={team.id}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid place-items-center text-center py-8 gap-3 text-sm font-medium">
                      <ValueNoneIcon className="size-10" />
                      No teams found
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <LeaveTeam leaveTeamId={leaveTeamId} setLeaveTeamId={setLeaveTeamId} />
      <DeleteTeam
        deleteTeamId={deleteTeamId}
        setDeleteTeamId={setDeleteTeamId}
      />
      <InviteTeamMembers
        teamId={inviteTeamMembersId}
        setTeamId={setInviteTeamMembersId}
      />
    </div>
  );
}

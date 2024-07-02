import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { InviteUsers } from "@/components/ui/invite-users";
import useSearch from "@/hooks/useSearch";
import { TeamResource } from "@prism/types";
import Fuse from "fuse.js";
import { TeamCard } from "@/components/ui/team-card";

// const searchTeamsFormSchema = z.object({
//   query: z.string(),
// });

export function AccountTeams() {
  const { data, isLoading } = useTeamsQuery();
  const { user } = useUserStore();
  const activeTeamStore = useActiveTeamStore();

  const [showInviteDialog, setShowInviteDialog] = React.useState(false);
  const [showCreateTeamDialog, setShowCreateTeamDialog] = React.useState(false);

  const [deleteTeamId, setDeleteTeamId] = React.useState("");
  const deleteTeamMutation = useDeleteTeamMutation();

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

  // const searchTeamsForm = useForm({
  //   resolver: zodResolver(searchTeamsFormSchema),
  //   defaultValues: {
  //     query: "",
  //   },
  // });

  // function onSubmitSearchTeamsForm(
  //   values: z.infer<typeof searchTeamsFormSchema>,
  // ) {
  //   console.log("values");
  // }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Teams</CardTitle>
            <CardDescription>Manage the teams you belong to.</CardDescription>
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
            <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teams..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* <Form {...searchTeamsForm}>
            <form
              onSubmit={searchTeamsForm.handleSubmit(onSubmitSearchTeamsForm)}
              className="space-y-4"
            >
              <FormField
                control={searchTeamsForm.control}
                name="query"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative mb-4">
                        <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search teams..."
                          className="pl-8"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form> */}

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
                            setShowInviteDialog={setShowInviteDialog}
                            key={team.id}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <>No teams found</>
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
                            setShowInviteDialog={setShowInviteDialog}
                            key={team.id}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <>No teams found</>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(deleteTeamId)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              All apps associated with this team will also be deleted. This
              action is irreversible.
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
              {deleteTeamMutation.isPending ? (
                <LoadingSpinner />
              ) : (
                "Delete Team"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteUsers open={showInviteDialog} setOpen={setShowInviteDialog} />
    </div>
  );
}

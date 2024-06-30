import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EllipsisVertical, Search } from "lucide-react";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/utils/getInitials";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserStore } from "@/store/userStore";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { Link } from "react-router-dom";

export function AccountTeams() {
  const { data, isLoading } = useTeamsQuery();
  const { user } = useUserStore();
  const activeTeamStore = useActiveTeamStore();

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>Manage the teams you belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search teams..." className="pl-8" />
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
              {data ? (
                <>
                  {data.map((team) => {
                    const isOwner = team.ownerId === user!.id;

                    // console.log({ team });

                    return (
                      <div
                        className="rounded-md border flex items-center gap-3 px-2 h-16"
                        key={team.id}
                      >
                        <Avatar className="ml-2 size-10">
                          <AvatarImage src={team.avatarUrl} alt={team.name} />
                          <AvatarFallback>
                            {getInitials(team.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-semibold">{team.name}</p>
                          <p className="text-sm">
                            {team.isPersonal ? "Personal" : "Other"}
                          </p>
                        </div>
                        <div className="ml-auto flex items-center">
                          <div className="flex gap-3">
                            <Link to={`/projects/${team.id}`}>
                              <Button variant="outline">View</Button>
                            </Link>
                            {isOwner ? (
                              <Button variant="outline">Settings</Button>
                            ) : null}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="size-10 rounded-lg ml-1 grid place-items-center transition duration-200 hover:bg-border/60">
                                <EllipsisVertical />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                onClick={() =>
                                  activeTeamStore.setTeamId(team.id)
                                }
                              >
                                Make Default
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {team.isPersonal ? null : (
                                <DropdownMenuItem className="text-destructive">
                                  Leave Team
                                </DropdownMenuItem>
                              )}
                              {isOwner ? (
                                <DropdownMenuItem className="text-destructive">
                                  Delete Team
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>No teams found</>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

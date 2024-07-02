import React from "react";
import { useUserStore } from "@/store/userStore";
import { TeamResource } from "@prism/types";
import { getInitials } from "@/utils/getInitials";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./dropdown-menu";
import { EllipsisVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "./button";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

type Props = {
  team: TeamResource;
  setInviteTeamMembersId: React.Dispatch<React.SetStateAction<string>>;
  setDeleteTeamId: React.Dispatch<React.SetStateAction<string>>;
};

export function TeamCard({
  team,
  setDeleteTeamId,
  setInviteTeamMembersId,
}: Props) {
  const { user } = useUserStore();
  const activeTeamStore = useActiveTeamStore();

  const isOwner = user!.id === team.ownerId;

  return (
    <div className="rounded-md border flex items-center gap-3 px-2 h-16">
      <Avatar className="ml-2 size-10">
        <AvatarImage src={team.avatarUrl} alt={team.name} />
        <AvatarFallback>{getInitials(team.name)}</AvatarFallback>
      </Avatar>
      <div>
        <p className="text-sm font-semibold">{team.name}</p>
        <p className="text-sm opacity-80">
          {team.isPersonal ? "Personal" : isOwner ? "Owner" : "Member"}
        </p>
      </div>
      <div className="ml-auto flex items-center">
        <div className="flex gap-3">
          <Link to={`/projects/${team.id}`}>
            <Button variant="outline">View</Button>
          </Link>
          {isOwner ? <Button variant="outline">Settings</Button> : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-10 rounded-lg ml-1 grid place-items-center transition duration-200 hover:bg-border/60">
              <EllipsisVertical />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => activeTeamStore.setTeamId(team.id)}
            >
              Set Default
            </DropdownMenuItem>
            {team.isPersonal ? null : (
              <DropdownMenuItem
                onClick={() => {
                  setInviteTeamMembersId(team.id);
                }}
              >
                Invite Users
              </DropdownMenuItem>
            )}
            {team.isPersonal ? null : (
              <>
                <DropdownMenuSeparator />

                {isOwner ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteTeamId(team.id)}
                  >
                    Delete Team
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-destructive">
                    Leave Team
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

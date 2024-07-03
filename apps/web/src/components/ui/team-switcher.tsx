import React from "react";
import {
  CaretSortIcon,
  CheckIcon,
  PlusCircledIcon,
} from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { Skeleton } from "./skeleton";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { getInitials } from "@/utils/getInitials";
import { CreateTeam } from "./create-team";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export default function TeamSwitcher() {
  const [open, setOpen] = React.useState(false);
  const [showNewTeamDialog, setShowNewTeamDialog] = React.useState(false);
  const activeTeamStore = useActiveTeamStore();
  const { isLoading, data } = useTeamsQuery();

  const activeTeam = React.useMemo(() => {
    if (!data) return null;

    if (!activeTeamStore.teamId)
      return data.filter(({ isPersonal }) => isPersonal)[0];

    return data.find(({ id }) => id === activeTeamStore.teamId);
  }, [data, activeTeamStore.teamId]);

  const groups = React.useMemo(() => {
    if (!data) return [];

    const personalTeam = data.filter(({ isPersonal }) => isPersonal)[0];

    const groups = [
      {
        label: "Personal Account",
        teams: [
          {
            label: personalTeam.name,
            value: personalTeam.id,
            avatar: personalTeam.avatarUrl,
          },
        ],
      },
    ];

    const teams = data
      .filter(({ isPersonal }) => !isPersonal)
      .map(({ name, id, avatarUrl }) => ({
        label: name,
        value: id,
        avatar: avatarUrl,
      }));

    if (teams.length > 0) {
      groups.push({ label: "Teams", teams });
    }

    return groups;
  }, [activeTeam, data]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-expanded={open}
            aria-label="Select a team"
            className="w-[210px] justify-between focus-visible:ring-0"
            disabled={!activeTeam}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            ) : (
              <>
                {activeTeam ? (
                  <>
                    <Avatar className="mr-2 size-5">
                      <AvatarImage
                        src={activeTeam.avatarUrl}
                        alt={activeTeam.name}
                      />
                      <AvatarFallback>
                        {getInitials(activeTeam.name)}
                      </AvatarFallback>
                    </Avatar>
                    <p className="truncate mr-1">{activeTeam.name}</p>
                    <CaretSortIcon className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                  </>
                ) : (
                  <>No teams found</>
                )}
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[210px]">
          {groups.map(({ label, teams }) => {
            return (
              <React.Fragment key={label}>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {label}
                </DropdownMenuLabel>
                {teams.map((team) => {
                  return (
                    <DropdownMenuItem
                      key={team.value}
                      onSelect={() => {
                        activeTeamStore.setTeamId(team.value);
                        setOpen(false);
                      }}
                      className="text-sm truncate"
                    >
                      <Avatar className="mr-2 size-5">
                        <AvatarImage src={team.avatar} alt={team.label} />
                        <AvatarFallback>
                          {getInitials(team.label)}
                        </AvatarFallback>
                      </Avatar>
                      {team.label}
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4",
                          activeTeam?.id === team.value
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </DropdownMenuItem>
                  );
                })}
              </React.Fragment>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              setShowNewTeamDialog(true);
            }}
          >
            <>
              <PlusCircledIcon className="mr-2 size-5" />
              Create Team
            </>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeam open={showNewTeamDialog} setOpen={setShowNewTeamDialog} />
    </>
  );
}

import React from "react";
import {
  CaretSortIcon,
  CheckIcon,
  PlusCircledIcon,
} from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { Skeleton } from "./skeleton";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { getInitials } from "@/utils/getInitials";

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface TeamSwitcherProps extends PopoverTriggerProps {}

export default function TeamSwitcher({ className }: TeamSwitcherProps) {
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
    <Dialog open={showNewTeamDialog} onOpenChange={setShowNewTeamDialog}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select a team"
            className={cn("w-[230px] justify-between", className)}
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
                  <>No team found</>
                )}
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0">
          <Command>
            <CommandList>
              <CommandInput placeholder="Search team..." />
              <CommandEmpty>No team found.</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.label} heading={group.label}>
                  {group.teams.map((team) => (
                    <CommandItem
                      key={team.value}
                      onSelect={() => {
                        activeTeamStore.setTeamId(team.value);
                        setOpen(false);
                      }}
                      className="text-sm"
                    >
                      <Avatar className="mr-2 h-5 w-5">
                        <AvatarImage src={team.avatar} alt={team.label} />
                        <AvatarFallback>SC</AvatarFallback>
                      </Avatar>
                      {team.label}
                      <CheckIcon
                        className={cn(
                          "ml-auto h-4 w-4",
                          activeTeam?.id === team.value
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            <CommandSeparator />
            <CommandList>
              <CommandGroup>
                <DialogTrigger asChild>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      setShowNewTeamDialog(true);
                    }}
                  >
                    <PlusCircledIcon className="mr-2 h-5 w-5" />
                    Create Team
                  </CommandItem>
                </DialogTrigger>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>Add a new team</DialogDescription>
        </DialogHeader>
        <div>
          <div className="space-y-4 py-2 pb-4">
            <div className="space-y-2">
              <Label htmlFor="name">Team name</Label>
              <Input id="name" placeholder="Acme Inc." />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowNewTeamDialog(false)}>
            Cancel
          </Button>
          <Button type="submit">Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

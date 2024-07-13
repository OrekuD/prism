import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "./dropdown-menu";
import { Button } from "./button";
import { Link } from "react-router-dom";
import { Laptop, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "../theme-provider";
import { useUserStore } from "@/store/userStore";
import { getInitials } from "@/utils/getInitials";
import { useSignOutMutation } from "@/network/mutations/useSignOutMutation";
import { LoadingSpinner } from "./loading-spinner";

const themes = [
  {
    icon: Laptop,
    value: "system" as const,
  },
  {
    icon: Sun,
    value: "light" as const,
  },
  {
    icon: Moon,
    value: "dark" as const,
  },
];

export function UserNav() {
  const { user } = useUserStore();
  const theme = useTheme();
  const signOutMutation = useSignOutMutation();

  const name = React.useMemo(() => {
    if (user?.userName) return user.userName;

    let name = "";
    if (user?.profile?.firstName) {
      name = user.profile.firstName;
    }

    if (user?.profile?.lastName) {
      name = name + " " + user.profile.lastName;
    }

    return name;
  }, [user?.userName, user?.profile?.firstName, user?.profile?.lastName]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={user?.profile?.profilePictureUrl || undefined}
              alt={name}
              className="object-cover"
            />
            <AvatarFallback>{`${getInitials(name)}`}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {Boolean(name) ? (
              <p className="text-sm font-medium leading-none">{name}</p>
            ) : null}
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link to="/account/general">
          <DropdownMenuItem className="justify-between">
            Account
            <Settings className="size-4" />
          </DropdownMenuItem>
        </Link>
        <DropdownMenuGroup>
          <div className="flex justify-between">
            <DropdownMenuItem>Theme</DropdownMenuItem>
            <div className="flex border gap-2 rounded-full py-1 px-2">
              {themes.map((_theme) => {
                const Icon = _theme.icon;
                const isActive = _theme.value === theme.theme;
                return (
                  <button
                    onClick={() => {
                      theme.setTheme(_theme.value);
                    }}
                    key={_theme.value}
                  >
                    <Icon
                      className={`size-4 ${isActive ? "" : "text-muted-foreground"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(e) => {
            signOutMutation.mutate();
            e.preventDefault();
          }}
          className="justify-between"
          disabled={signOutMutation.isPending}
        >
          Log out
          {signOutMutation.isPending ? (
            <LoadingSpinner className="size-4" />
          ) : (
            <LogOut className="size-4" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

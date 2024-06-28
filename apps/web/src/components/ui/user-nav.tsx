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
import { Laptop, LogOut, Moon, Settings, Sun, SunMoon } from "lucide-react";
import { useTheme } from "../theme-provider";
import { useCurrentUser } from "@/network/queries/useCurrentUser";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarImage src="/avatars/01.png" alt="@shadcn" />
            <AvatarFallback>SC</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">shadcn</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link to="/account">
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
        <DropdownMenuItem onClick={() => {}} className="justify-between">
          Log out
          <LogOut className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

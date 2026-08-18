import React from "react";
import { Separator } from "../ui/separator";
import { Link, Outlet, useLocation } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";

// Workspace settings lives at /:wrkSlug/settings/* — tabs on the left,
// mirroring the project-settings layout.
const links = [{ label: "General", url: "general" }];

export function WorkspaceSettingsLayout() {
  const { pathname } = useLocation();

  const path = pathname.split("/")[pathname.split("/").length - 1] || "";

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your workspace settings.
        </p>
      </div>
      <Separator className="my-6" />
      <div className="flex flex-col lg:flex-row lg:space-y-0 gap-8">
        <aside className="lg:w-1/5">
          <nav className="flex space-x-2 md:sticky md:top-24 lg:flex-col lg:space-x-0 lg:space-y-1">
            {links.map((item) => {
              const isActive = item.url === path;

              return (
                <Link
                  key={item.url}
                  to={item.url}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    isActive ? "bg-muted hover:bg-muted" : "hover:bg-muted",
                    "justify-start transition-colors duration-200",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/public/page-header";

// Workspace settings lives at /:wrkSlug/settings/* — tabs on the left,
// mirroring the project-settings layout. A single tab renders no rail.
const links = [{ label: "General", url: "general" }];

export function WorkspaceSettingsLayout() {
  const { pathname } = useLocation();

  const path = pathname.split("/")[pathname.split("/").length - 1] || "";
  const showRail = links.length > 1;

  return (
    <div className="mx-auto w-full max-w-[880px] space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your workspace settings."
      />
      <div className="flex flex-col lg:flex-row lg:space-y-0 gap-8">
        {showRail ? (
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
        ) : null}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

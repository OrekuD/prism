import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/public/page-header";

// Task 13: the ingestion-key workflow lives in the project's Sources
// tab (source detail owns SDK setup + rotation) — no standalone API
// keys page.
const links = [{ label: "General", url: "general" }];

export function ProjectSettingsLayout() {
  const { pathname } = useLocation();

  const path = pathname.split("/")[pathname.split("/").length - 1] || "";

  return (
    <div className="space-y-10">
      <PageHeader
        title="Settings"
        description="Manage your project settings."
      />
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
                    "justify-start transition-colors duration-200"
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

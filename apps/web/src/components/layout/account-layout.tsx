import { Link, Outlet, useLocation } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/public/page-header";

// Account settings lives at /account/* — links on the left, mirroring the
// workspace and project settings layouts. Unlinked routes (authentication,
// workspace) keep their legacy pages until they are retired or migrated.
const links = [
  { label: "General", url: "general" },
  { label: "Security", url: "security" },
];

export function AccountLayout() {
  const { pathname } = useLocation();
  const path = pathname.split("/").filter(Boolean).pop() ?? "";

  return (
    <div className="mx-auto w-full space-y-6">
      <PageHeader />
      <div className="flex flex-col gap-8 lg:flex-row lg:space-y-0">
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
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

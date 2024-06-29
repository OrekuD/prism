import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

const links = [
  { label: "General", url: "" },
  { label: "Security", url: "security" },
  // { label: "Authentication", url: "authentication" },
  { label: "Teams", url: "teams" },
];

export function AccountLayout() {
  const { pathname } = useLocation();

  const path = pathname.slice(9) || "";

  return (
    <div className="flex w-full flex-col">
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-10">
        {/* <div className="mx-auto grid w-full max-w-6xl gap-2">
        </div> */}
        <div className="mx-auto grid w-full max-w-6xl items-start gap-6 md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr]">
          <nav className="sticky top-28 grid gap-1 text-sm text-muted-foreground">
            <h1 className="text-3xl text-foreground font-semibold mb-4">
              Account Settings
            </h1>
            {links.map(({ label, url }) => {
              const isActive = url === path;
              return (
                <Link
                  to={url}
                  key={url}
                  className={`font-medium py-2 ${isActive ? "text-card-foreground" : "text-muted-foreground"}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="pt-20">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

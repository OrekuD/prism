import React from "react";
import { authClient } from "@/lib/authClient";
import { Outlet, useLocation } from "react-router-dom";
import { Nav } from "../ui/nav";

const excludedPaths = ["/join"];

export function RootLayout() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const { pathname } = useLocation();

  if (isAuthenticated) {
    return (
      <>
        {excludedPaths.includes(pathname) ? null : <Nav />}
        <div
          className={`max-w-[1800px] mx-auto px-4 md:px-10 ${excludedPaths.includes(pathname) ? "" : "pt-32 md:pt-16"}`}
        >
          <Outlet />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="py-3 max-w-[1800px] mx-auto px-4 md:px-10">
        <Outlet />
      </div>
    </>
  );
}

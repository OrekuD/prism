import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Nav } from "../ui/nav";
import { useAuthenticationStore } from "@/store/authenticationStore";

const excludedPaths = ["/join"];

export function RootLayout() {
  const { isAuthenticated } = useAuthenticationStore();
  const { pathname } = useLocation();

  if (isAuthenticated) {
    return (
      <>
        {excludedPaths.includes(pathname) ? null : <Nav />}
        <div
          className={`max-w-[1400px] mx-auto ${excludedPaths.includes(pathname) ? "" : "pt-16 "}`}
        >
          <Outlet />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="py-3 max-w-[1400px] mx-auto">
        <Outlet />
      </div>
    </>
  );
}

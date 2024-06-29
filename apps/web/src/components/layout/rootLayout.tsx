import React from "react";
import { Outlet } from "react-router-dom";
import { Nav } from "../ui/nav";
import { useAuthenticationStore } from "@/store/authenticationStore";

export function RootLayout() {
  const { isAuthenticated } = useAuthenticationStore();

  if (isAuthenticated) {
    return (
      <>
        <Nav />
        <div className="py-3 max-w-[1400px] mx-auto">
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

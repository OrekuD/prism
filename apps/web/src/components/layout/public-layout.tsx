import type React from "react";
import { Outlet, useMatch } from "react-router-dom";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicNav } from "@/components/public/public-nav";

/** Full-width public canvas; each page owns its own content width. */
export function PublicLayout({
  children,
}: {
  children?: React.ReactNode;
}) {
  const isAuthRoute = useMatch("/auth/*");
  if (isAuthRoute) {
    return <main className="flex min-h-dvh flex-col bg-canvas text-text">{children ?? <Outlet />}</main>;
  }
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-text">
      <PublicNav />
      <main className="flex flex-1 flex-col pt-[70px]">
        <div className="flex flex-1 flex-col">{children ?? <Outlet />}</div>
        <PublicFooter />
      </main>
    </div>
  );
}

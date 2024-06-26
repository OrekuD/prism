import React from "react";
import { Card } from "@/components/ui/card";
import { Link, Outlet } from "react-router-dom";

export default function ProfileLayout() {
  return (
    <div className="flex w-full flex-col">
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-10">
        <div className="mx-auto grid w-full max-w-6xl gap-2">
          <h1 className="text-3xl font-semibold">Settings</h1>
        </div>
        <div className="mx-auto grid w-full max-w-6xl items-start gap-6 md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr]">
          <nav
            className="grid gap-4 text-sm text-muted-foreground"
            x-chunk="dashboard-04-chunk-0"
          >
            <Link to="#" className="font-semibold text-primary">
              General
            </Link>
            <Link to="#">Security</Link>
            <Link to="#">Integrations</Link>
            <Link to="#">Support</Link>
            <Link to="#">Organizations</Link>
            <Link to="#">Advanced</Link>
          </nav>
          <Card>
            <Outlet />
          </Card>
        </div>
      </main>
    </div>
  );
}

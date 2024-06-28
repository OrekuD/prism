import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDateRangePicker } from "@/components/ui/date-range-picker";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const tabs = [
  {
    label: "Overview",
    url: "",
  },
  {
    label: "Events",
    url: "events",
  },
  {
    label: "Settings",
    url: "settings",
  },
];

const projectId = "ddd";

export function AppLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const path = pathname.split("/")?.[3] || "";

  return (
    <>
      <div className="flex flex-col md:flex-row">
        <div className="flex-1 space-y-4 pt-6">
          <div className="flex items-center justify-between space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">App Name</h2>
            <div className="flex items-center space-x-2">
              <CalendarDateRangePicker />
              <Button>Download</Button>
            </div>
          </div>
          <Tabs defaultValue="summary" value={path} className="space-y-4">
            <TabsList>
              {tabs.map(({ label, url }) => (
                <TabsTrigger
                  value={url}
                  key={url}
                  onClick={() => {
                    if (!url) {
                      navigate(`/apps/${projectId}`);
                    } else {
                      navigate(`/apps/${projectId}/${url}`);
                    }
                  }}
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={path} className="space-y-4">
              <Outlet />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}

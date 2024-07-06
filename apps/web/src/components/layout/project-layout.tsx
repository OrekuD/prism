import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDateRangePicker } from "@/components/ui/date-range-picker";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { ValueNoneIcon } from "@radix-ui/react-icons";
import { Skeleton } from "../ui/skeleton";

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

export function ProjectLayout() {
  const { pathname } = useLocation();
  const params = useParams<{ slug: string }>();

  const projectQuery = useProjectQuery(params.slug);

  const navigate = useNavigate();
  const path = pathname.split("/")?.[3] || "";

  if (!projectQuery.isLoading && !projectQuery.data) {
    return (
      <div className="pt-[15vh] grid place-items-center text-center gap-3 text-sm">
        <ValueNoneIcon className="size-16" />
        <p>Project not found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col md:flex-row">
        <div className="flex-1 space-y-4 pt-6">
          <div className="flex items-center justify-between space-y-2">
            {projectQuery.isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <h2 className="text-3xl font-bold tracking-tight">
                {projectQuery.data?.name}
              </h2>
            )}

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
                  disabled={!projectQuery.data}
                  onClick={() => {
                    if (!url) {
                      navigate(`/projects/${params.slug!}`);
                    } else {
                      navigate(`/projects/${params.slug!}/${url}`);
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

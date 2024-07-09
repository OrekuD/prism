import React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDateRangePicker } from "@/components/ui/date-range-picker";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { ValueNoneIcon } from "@radix-ui/react-icons";
import { Skeleton } from "../ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

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
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const duration: any = searchParams.get("duration");

  const projectQuery = useProjectQuery({ slug, duration });

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
            <Select
              onValueChange={(e) => {
                setSearchParams({
                  duration: e,
                });
              }}
              defaultValue={duration || undefined}
            >
              <SelectTrigger className="w-[140px] md:w-[180px]">
                <SelectValue placeholder="Duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24-hours">24 hours</SelectItem>
                <SelectItem value="seven-days">7 days</SelectItem>
                <SelectItem value="two-weeks">2 weeks</SelectItem>
                <SelectItem value="one-month">1 month</SelectItem>
                <SelectItem value="three-months">3 months</SelectItem>
                <SelectItem value="one-year">1 year</SelectItem>
              </SelectContent>
            </Select>
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
                      navigate(`/projects/${slug!}`);
                    } else {
                      navigate(`/projects/${slug!}/${url}`);
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

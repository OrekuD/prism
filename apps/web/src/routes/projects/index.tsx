import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { CreateNewProject } from "@/components/ui/create-new-project";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { useUserStore } from "@/store/userStore";
import { ValueNoneIcon } from "@radix-ui/react-icons";
import { Search } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
} from "recharts";

const placeholders = Array(3).fill(null);

const chartConfig = {
  views: {
    label: "Page Views",
  },
  desktop: {
    label: "Desktop",
    color: "hsl(var(--primary))",
  },
  mobile: {
    label: "Mobile",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

export function Projects() {
  const projectsQuery = useProjectsQuery();
  const teamsQuery = useTeamsQuery();
  const activeTeamStore = useActiveTeamStore();
  const userStore = useUserStore();

  const activeTeam = React.useMemo(() => {
    if (!teamsQuery.data) return null;

    if (!activeTeamStore.teamId)
      return teamsQuery.data.filter(({ isPersonal }) => isPersonal)[0];

    return teamsQuery.data.find(({ id }) => id === activeTeamStore.teamId);
  }, [teamsQuery.data, activeTeamStore.teamId]);

  const hasSettingsPermission = React.useMemo(
    () => activeTeam?.ownerId === userStore.user?.id,
    [activeTeam, userStore.user?.id],
  );

  // throw new Error("S");

  return (
    <div className="py-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <form className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-3 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search projects..."
              className="pl-8 w-full"
            />
          </div>
        </form>
        <div className="flex gap-3">
          <CreateNewProject>
            <Button>New App</Button>
          </CreateNewProject>
          {hasSettingsPermission ? <Button>Team Settings</Button> : null}
        </div>
      </div>
      <div className="py-4">
        {projectsQuery.isLoading || projectsQuery.isRefetching ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {placeholders.map((_, index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-[20px]" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-[150px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {projectsQuery.data && projectsQuery.data.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {projectsQuery.data.map(({ id, name, slug, summary }) => {
                  return (
                    <Link to={`/projects/${slug}`} key={id}>
                      <Card className="">
                        <CardHeader>
                          <CardTitle className="text-md">{name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[150px]">
                            <ResponsiveContainer
                              width="100%"
                              height="100%"
                              className="pb-2"
                            >
                              <ChartContainer
                                config={chartConfig}
                                className="aspect-auto h-[250px] w-full"
                              >
                                <AreaChart data={summary}>
                                  <defs>
                                    <linearGradient
                                      id="fillDesktop"
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop
                                        offset="5%"
                                        stopColor="var(--color-desktop)"
                                        stopOpacity={0.8}
                                      />
                                      <stop
                                        offset="95%"
                                        stopColor="var(--color-desktop)"
                                        stopOpacity={0.1}
                                      />
                                    </linearGradient>
                                    <linearGradient
                                      id="fillMobile"
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop
                                        offset="5%"
                                        stopColor="var(--color-mobile)"
                                        stopOpacity={0.8}
                                      />
                                      <stop
                                        offset="95%"
                                        stopColor="var(--color-mobile)"
                                        stopOpacity={0.1}
                                      />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid vertical={false} />
                                  <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={8}
                                    minTickGap={32}
                                    tickFormatter={(value) => {
                                      const date = new Date(value);
                                      return date.toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      });
                                    }}
                                  />
                                  <ChartTooltip
                                    cursor={false}
                                    content={
                                      <ChartTooltipContent
                                        labelFormatter={(value) => {
                                          return new Date(
                                            value,
                                          ).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                          });
                                        }}
                                        indicator="dot"
                                      />
                                    }
                                  />
                                  <Area
                                    dataKey="mobile"
                                    type="natural"
                                    fill="url(#fillMobile)"
                                    stroke="var(--color-mobile)"
                                    stackId="a"
                                  />
                                  <Area
                                    dataKey="desktop"
                                    type="natural"
                                    fill="url(#fillDesktop)"
                                    stroke="var(--color-desktop)"
                                    stackId="a"
                                  />
                                  <ChartLegend
                                    content={<ChartLegendContent />}
                                  />
                                </AreaChart>
                              </ChartContainer>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="pt-[15vh] grid place-items-center text-center gap-3 text-sm">
                <ValueNoneIcon className="size-16" />
                <p>You do not have any projects for this team.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

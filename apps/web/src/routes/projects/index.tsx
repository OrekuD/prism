import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

const placeholders = Array(3).fill(null);

// const chart = [
//   {
//     average: 400,
//     today: 240,
//   },
//   {
//     average: 300,
//     today: 139,
//   },
//   {
//     average: 200,
//     today: 980,
//   },
//   {
//     average: 278,
//     today: 390,
//   },
//   {
//     average: 189,
//     today: 480,
//   },
//   {
//     average: 239,
//     today: 380,
//   },
//   {
//     average: 349,
//     today: 430,
//   },
// ];

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
                              <LineChart
                                data={summary}
                                margin={{
                                  top: 5,
                                  right: 10,
                                  left: 10,
                                  bottom: 0,
                                }}
                              >
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                      return (
                                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                                          <div className="grid grid-cols-2 gap-2">
                                            <div className="flex flex-col">
                                              <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                Average
                                              </span>
                                              <span className="font-bold text-muted-foreground">
                                                {payload[0].value}
                                              </span>
                                            </div>
                                            <div className="flex flex-col">
                                              <span className="text-[0.70rem] uppercase text-muted-foreground">
                                                Today
                                              </span>
                                              <span className="font-bold">
                                                {payload[1].value}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }

                                    return null;
                                  }}
                                />
                                <Line
                                  type="monotone"
                                  strokeWidth={2}
                                  dataKey="mobile"
                                  activeDot={{
                                    r: 6,
                                    style: {
                                      fill: "var(--theme-primary)",
                                      opacity: 0.25,
                                    },
                                  }}
                                  style={
                                    {
                                      stroke: "var(--theme-primary)",
                                      opacity: 0.25,
                                      "--theme-primary": `hsl(var(--primary))`,
                                    } as React.CSSProperties
                                  }
                                />
                                <Line
                                  type="monotone"
                                  dataKey="desktop"
                                  strokeWidth={2}
                                  activeDot={{
                                    r: 8,
                                    style: { fill: "var(--theme-primary)" },
                                  }}
                                  style={
                                    {
                                      stroke: "var(--theme-primary)",
                                      "--theme-primary": `hsl(var(--primary))`,
                                    } as React.CSSProperties
                                  }
                                />
                              </LineChart>
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

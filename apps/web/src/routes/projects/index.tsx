import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

const data = [
  {
    average: 400,
    today: 240,
  },
  {
    average: 300,
    today: 139,
  },
  {
    average: 200,
    today: 980,
  },
  {
    average: 278,
    today: 390,
  },
  {
    average: 189,
    today: 480,
  },
  {
    average: 239,
    today: 380,
  },
  {
    average: 349,
    today: 430,
  },
];

export default function Projects() {
  const { theme } = useTheme();
  return (
    <div className="py-4">
      <div className="flex items-center gap-3">
        <form className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search projects..."
              className="pl-8 w-full"
            />
          </div>
        </form>
        <Button>Create New</Button>
      </div>
      <div className="grid grid-cols-3 py-4">
        <Link to="/projects/dd/summary">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-md">Project Name</CardTitle>
              <CardDescription>Project description</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
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
                      dataKey="average"
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
                      dataKey="today"
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
      </div>
    </div>
  );
}

import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import "mapbox-gl/dist/mapbox-gl.css";
import MapGL from "react-map-gl/mapbox";
import { useTheme } from "@/components/theme-provider";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import type { MapRef } from "react-map-gl/mapbox";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { WebSocketManager } from "@/managers/WebSocketManager";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useActiveSessionsStore } from "@/store/activeSessionsStore";

export function ProjectRealtime() {
  const isDarkTheme = useIsDarkTheme();
  const ref = React.useRef<MapRef>(null);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const projectQuery = useProjectQuery({
    slug,
    duration: null,
  });
  const { sessions } = useActiveSessionsStore();
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;


  if (!mapboxToken) {
    return (
      <WebSocketManager projectId={projectQuery.data?.id}>
        <div className="w-full relative py-5 h-full-screen-sm md:h-full-screen">
          <EmptyState
            label="Realtime"
            title="Map unavailable"
            description="Set VITE_MAPBOX_ACCESS_TOKEN in apps/web/.env.local to see live session markers. Session data keeps flowing either way."
          />
        </div>
      </WebSocketManager>
    );
  }
  return (
    <WebSocketManager projectId={projectQuery.data?.id}>
      <div className="w-full relative animate-fade-in isolate py-5 h-full-screen-sm md:h-full-screen">
        <button
          type="button"
          className="absolute top-9 left-3 h-10 bg-background rounded-lg px-2 z-20 flex items-center gap-2 text-sm"
          onClick={() => navigate(-1)}
        >
          <ArrowLeftIcon className="text-primary" />
          Go back
        </button>
        <MapGL
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}
          initialViewState={{
            longitude: -1.023194,
            latitude: 7.946527,
            zoom: 3.5,
          }}
          ref={ref}
          // boxZoom={false}
          // doubleClickZoom={false}
          // scrollZoom={false}
          style={{ width: "100%", height: "100%", borderRadius: 6 }}
          mapStyle={
            isDarkTheme
              ? "mapbox://styles/mapbox/dark-v10"
              : "mapbox://styles/mapbox/light-v10"
          }
          attributionControl={false}
        />
      </div>
      {/* v2 session rows (task-9 slice 6): the v2 model carries NO raw IP
          or coordinates — sessions render as useful list rows (null geo
          must not break the Mapbox-optional page). */}
      <div className="mt-4 grid gap-3">
        {sessions.length === 0 ? (
          <EmptyState
            label="Live sessions"
            title="Waiting for sessions"
            description="Sessions appear here when a Prism v2 SDK calls startSession() against this project."
          />
        ) : (
          sessions.map((session) => (
            <Card key={session.sessionId}>
              <CardHeader className="py-3">
                <CardTitle className="font-mono text-sm">
                  {session.sessionId.slice(0, 12)}…
                </CardTitle>
                <CardDescription>
                  {session.isOnline === 1 ? "Online" : "Ended"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 py-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Started</span>
                  <span>{new Date(session.startedAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Last seen</span>
                  <span>{new Date(session.lastSeenAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Anonymous ID</span>
                  <span className="truncate font-mono text-xs">
                    {session.anonymousId?.slice(0, 12) ?? "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </WebSocketManager>
  );
}

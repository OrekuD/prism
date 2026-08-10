import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import "mapbox-gl/dist/mapbox-gl.css";
import MapGL, { Marker } from "react-map-gl/mapbox";
import countries from "@/data/countries.json";
import { useTheme } from "@/components/theme-provider";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import type { MapRef } from "react-map-gl/mapbox";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

  // React.useEffect(() => {
  //   if (!ref.current) return;

  //   const country = countries[40];

  //   ref.current.flyTo({
  //     center: [country.longitude, country.latitude],
  //   });
  // }, []);
  //

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
        >
          {sessions.map((session) => {
            return (
              <Marker
                longitude={Number.parseFloat(session.long)}
                latitude={Number.parseFloat(session.lat)}
                anchor="bottom"
                key={session.id}
              >
                <Sheet>
                  <SheetTrigger asChild>
                    <button
                      type="button"
                      className="size-5 bg-blue-600 rounded-full animate-scale-pulse motion-reduce:animate-none"
                    />
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Session details</SheetTitle>
                      <SheetDescription>
                        Live session captured by the Prism SDK.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="grid gap-3 py-4 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Referrer</span>
                        <span className="truncate">{session.referrer || "—"}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Country</span>
                        <span>{session.country_code || "—"}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Device</span>
                        <span>
                          {session.os} · {session.browser}{" "}
                          {session.is_mobile === 1 ? "(mobile)" : ""}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Location</span>
                        <span>{session.location || "—"}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Coordinates</span>
                        <span>
                          {session.lat}, {session.long}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Started</span>
                        <span>{new Date(session.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <SheetFooter>
                      <SheetClose asChild>
                        <Button type="button">Close</Button>
                      </SheetClose>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </Marker>
            );
          })}
        </MapGL>
      </div>
    </WebSocketManager>
  );
}

import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
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

  // React.useEffect(() => {
  //   if (!ref.current) return;

  //   const country = countries[40];

  //   ref.current.flyTo({
  //     center: [country.longitude, country.latitude],
  //   });
  // }, []);
  //

  return (
    <WebSocketManager projectId={projectQuery.data?.id}>
      <div className="w-full relative animate-fade-in isolate py-5 h-fullScreenSm md:h-fullScreen">
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
                      className="size-5 bg-blue-600 rounded-full animate-scale-pulse"
                    />
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Edit profile</SheetTitle>
                      <SheetDescription>
                        Make changes to your profile here. Click save when
                        you're done.
                      </SheetDescription>
                    </SheetHeader>
                    <SheetFooter>
                      <SheetClose asChild>
                        <Button type="submit">Save changes</Button>
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

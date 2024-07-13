import React from "react";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import Map, { Marker } from "react-map-gl";
import countries from "@/data/countries.json";
import { useTheme } from "@/components/theme-provider";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { MapRef } from "react-map-gl";
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

export function ProjectRealtime() {
  const isDarkTheme = useIsDarkTheme();
  const ref = React.useRef<MapRef>(null);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const projectQuery = useProjectQuery({
    slug,
    duration: null,
  });

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
          className="absolute top-9 left-3 h-10 bg-background rounded-lg px-2 z-20 flex items-center gap-2 text-sm"
          onClick={() => navigate(-1)}
        >
          <ArrowLeftIcon className="text-primary" />
          Go back
        </button>
        <Map
          mapboxAccessToken="pk.eyJ1Ijoib3Jla3VkIiwiYSI6ImNseWZpOW4xcTA1OXoya3NrdnRtemx2bG4ifQ.ntXi9XxB4bmaYhBOk9MUcw"
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
          <Marker longitude={-1.023194} latitude={7.946527} anchor="bottom">
            <Sheet>
              <SheetTrigger asChild>
                <button className="size-5 bg-blue-600 rounded-full animate-scale-pulse" />
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Edit profile</SheetTitle>
                  <SheetDescription>
                    Make changes to your profile here. Click save when you're
                    done.
                  </SheetDescription>
                </SheetHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">
                      Name
                    </Label>
                    <Input
                      id="name"
                      value="Pedro Duarte"
                      className="col-span-3"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="username" className="text-right">
                      Username
                    </Label>
                    <Input
                      id="username"
                      value="@peduarte"
                      className="col-span-3"
                    />
                  </div>
                </div>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button type="submit">Save changes</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </Marker>
        </Map>
      </div>
    </WebSocketManager>
  );
}

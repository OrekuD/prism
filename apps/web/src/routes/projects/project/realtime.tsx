import React from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import MapGL, { Marker } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { WebSocketManager } from "@/managers/WebSocketManager";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useActiveSessionsStore } from "@/store/activeSessionsStore";
import type { SessionResource } from "@prism-analytics/types";
import Supercluster from "supercluster";
import { useParams } from "react-router-dom";

const EMPTY_SESSIONS: SessionResource[] = [];

// City → [lng, lat] — jittered at render so the globe never looks empty.
// Derived from seeder LOCATIONS (country_code/city) at city-level accuracy.
type LivePointProps = PointProps & { live?: boolean };

const CITY_COORDS: Record<string, [number, number]> = {
  "San Francisco": [-122.4194, 37.7749],
  "New York": [-74.006, 40.7128],
  Austin: [-97.7431, 30.2672],
  Seattle: [-122.3321, 47.6062],
  Chicago: [-87.6298, 41.8781],
  Miami: [-80.1918, 25.7617],
  Toronto: [-79.3832, 43.6532],
  Vancouver: [-123.1207, 49.2827],
  London: [-0.1278, 51.5074],
  Edinburgh: [-3.1883, 55.9533],
  Munich: [11.582, 48.1351],
  Berlin: [13.405, 52.52],
  Hamburg: [9.9937, 53.5511],
  Paris: [2.3522, 48.8566],
  Lyon: [4.8357, 45.764],
  Madrid: [-3.7038, 40.4168],
  Barcelona: [2.1734, 41.3851],
  Milan: [9.19, 45.4642],
  Amsterdam: [4.9041, 52.3676],
  Lisbon: [-9.1393, 38.7223],
  "São Paulo": [-46.6333, -23.5505],
  "Rio de Janeiro": [-43.1729, -22.9068],
  "Mexico City": [-99.1332, 19.4326],
  Tokyo: [139.692, 35.6895],
  Osaka: [135.5023, 34.6937],
  Seoul: [126.978, 37.5665],
  Beijing: [116.4074, 39.9042],
  Shanghai: [121.4737, 31.2304],
  Taipei: [121.5654, 25.033],
  Mumbai: [72.8777, 19.076],
  Bangalore: [77.5946, 12.9716],
  Sydney: [151.2093, -33.8688],
  Melbourne: [144.9631, -37.8136],
  Singapore: [103.8198, 1.3521],
  Stockholm: [18.0686, 59.3293],
  Oslo: [10.7522, 59.9139],
  Copenhagen: [12.5683, 55.6761],
  Zurich: [8.5417, 47.3769],
  Vienna: [16.3738, 48.2082],
  Warsaw: [21.0122, 52.2297],
  Lagos: [3.3792, 6.5244],
  Johannesburg: [28.0473, -26.2041],
  Dubai: [55.2708, 25.2048],
  Riyadh: [46.6753, 24.7136],
  Jakarta: [106.8456, -6.2088],
  Bangkok: [100.5018, 13.7563],
  "Ho Chi Minh City": [106.6297, 10.8231],
  Manila: [120.9842, 14.5995],
  "Kuala Lumpur": [101.6869, 3.139],
};

type PointProps = { city: string; country?: string };
type ClusterProps = { cluster: true; point_count: number; cluster_id: number };

function pointsForPreview(): GeoJSON.Feature<GeoJSON.Point, PointProps>[] {
  const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];
  let id = 0;
  for (const [city, coord] of Object.entries(CITY_COORDS)) {
    // Weight by roughly seeded popularity: US/EU/IN/BR get more dots.
    const weight = [
      "San Francisco",
      "New York",
      "London",
      "São Paulo",
      "Tokyo",
      "Mumbai",
    ].includes(city)
      ? 9
      : [
            "Seattle",
            "Chicago",
            "Berlin",
            "Paris",
            "Singapore",
            "Sydney",
          ].includes(city)
        ? 6
        : 3;
    for (let i = 0; i < weight; i++) {
      const [lng, lat] = coord as [number, number];
      const jitterLng = (Math.random() - 0.5) * 1.2;
      const jitterLat = (Math.random() - 0.5) * 0.9;
      features.push({
        type: "Feature",
        id: id++,
        geometry: {
          type: "Point",
          coordinates: [lng + jitterLng, lat + jitterLat],
        },
        properties: { city },
      });
    }
  }
  return features;
}

export function ProjectRealtime() {
  const isDarkTheme = useIsDarkTheme();
  const mapRef = React.useRef<MapRef>(null);
  const { slug } = useParams<{ slug: string }>();
  const projectQuery = useProjectQuery({ slug, duration: null });
  const sessionsByProject = useActiveSessionsStore((s) => s.sessionsByProject);
  const sessions = projectQuery.data?.id
    ? (sessionsByProject[projectQuery.data.id] ?? EMPTY_SESSIONS)
    : EMPTY_SESSIONS;
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as
    string | undefined;

  const [zoom, setZoom] = React.useState(1.4);
  const [bounds, setBounds] = React.useState<[number, number, number, number]>([
    -180, -85, 180, 85,
  ]);

  const points = React.useMemo(() => pointsForPreview(), []);
  // Blend live sessions in when they exist — map them to city coords via
  // a deterministic hash of sessionId so the dots move city-to-city live.
  const livePoints = React.useMemo(() => {
    if (sessions.length === 0) return [];
    const cities = Object.keys(CITY_COORDS);
    return sessions.slice(0, 120).map((s, idx) => {
      const city = cities[hashString(s.sessionId) % cities.length] as string;
      const base = CITY_COORDS[city] as [number, number];
      const jitterLng = (Math.random() - 0.5) * 0.6;
      const jitterLat = (Math.random() - 0.5) * 0.4;
      return {
        type: "Feature" as const,
        id: `live-${idx}`,
        geometry: {
          type: "Point" as const,
          coordinates: [base[0] + jitterLng, base[1] + jitterLat] as [
            number,
            number,
          ],
        },
        properties: { city, live: true } as PointProps & { live?: boolean },
      };
    });
  }, [sessions]);

  const allPoints = React.useMemo(
    () => (livePoints.length > 0 ? [...points, ...livePoints] : points),
    [points, livePoints]
  );

  const supercluster = React.useMemo(() => {
    const sc = new Supercluster<LivePointProps, ClusterProps>({
      radius: 40,
      maxZoom: 16,
      minPoints: 2,
    });
    sc.load(allPoints as unknown as GeoJSON.Feature<GeoJSON.Point, LivePointProps>[]);
    return sc;
  }, [allPoints]);

  const clusters = React.useMemo(
    () =>
      supercluster.getClusters(
        bounds as [number, number, number, number],
        Math.floor(zoom)
      ),
    [supercluster, bounds, zoom]
  );

  if (!mapboxToken) {
    return (
      <div className="flex flex-1 min-h-0 w-full items-center justify-center rounded-[2px] border border-border bg-surface">
        <div className="max-w-[420px] p-6 text-center">
          <p className="font-sans text-[14px] font-medium text-text">
            Map unavailable
          </p>
          <p className="mt-1.5 font-mono text-[12px] leading-[1.5] text-text-muted">
            Set{" "}
            <span className="font-medium text-text">
              VITE_MAPBOX_ACCESS_TOKEN
            </span>{" "}
            in
            <span className="font-mono"> apps/web/.env.local</span> to see the
            live globe. Live dots are city-level derived from
            <span className="font-mono"> country_code</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WebSocketManager projectId={projectQuery.data?.id}>
      <div className="relative flex flex-1 min-h-0 w-full flex-col overflow-hidden rounded-[2px] border border-border bg-[#0a0a0a]">
        <MapGL
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={{ longitude: 0, latitude: 20, zoom: 1.4 }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={
            isDarkTheme
              ? "mapbox://styles/mapbox/dark-v10"
              : "mapbox://styles/mapbox/light-v10"
          }
          attributionControl={false}
          onMove={(e) => {
            setZoom(e.viewState.zoom);
            const b = e.target.getBounds();
            if (b)
              setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }}
          onLoad={(e) => {
            const b = e.target.getBounds();
            if (b)
              setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          }}
        >
          {clusters.map(
            (
              feature:
                | Supercluster.ClusterFeature<ClusterProps>
                | Supercluster.PointFeature<LivePointProps>
            ) => {
              const [lng, lat] = (feature.geometry as GeoJSON.Point)
                .coordinates as [number, number];
              const props = feature.properties as PointProps &
                Partial<ClusterProps>;
              const isCluster = Boolean((props as ClusterProps).cluster);
              if (isCluster) {
                const count = (props as ClusterProps).point_count;
                const size = count < 10 ? 28 : count < 30 ? 36 : 44;
                return (
                  <Marker
                    key={`cluster-${feature.id}`}
                    longitude={lng}
                    latitude={lat}
                    anchor="center"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const expansionZoom = Math.min(
                          supercluster.getClusterExpansionZoom(
                            feature.id as number
                          ),
                          16
                        );
                        mapRef.current?.easeTo({
                          center: [lng, lat],
                          zoom: expansionZoom,
                          duration: 500,
                        });
                      }}
                      className="grid place-items-center rounded-full border border-white/15 bg-accent font-mono text-[11px] font-medium text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-transform hover:scale-105"
                      style={{ width: size, height: size }}
                      aria-label={`Cluster of ${count} users`}
                    >
                      {count}
                    </button>
                  </Marker>
                );
              }
              // Single point — size grows with zoom.
              const dotSize = zoom < 3 ? 6 : zoom < 5 ? 8 : 10;
              const isLive = Boolean((props as { live?: boolean }).live);
              return (
                <Marker
                  key={`pt-${feature.id}`}
                  longitude={lng}
                  latitude={lat}
                  anchor="center"
                >
                  <span
                    className="block rounded-full border border-white/20 shadow-[0_1px_6px_rgba(0,0,0,0.4)]"
                    style={{
                      width: dotSize,
                      height: dotSize,
                      background: isLive
                        ? "#22c55e"
                        : isDarkTheme
                          ? "#e5e7eb"
                          : "#111827",
                      boxShadow: isLive
                        ? "0 0 0 4px rgba(34,197,94,0.18)"
                        : undefined,
                    }}
                    title={props.city}
                    aria-hidden="true"
                  />
                </Marker>
              );
            }
          )}
        </MapGL>

        {/* Subtle top bar — live count, not a card grid */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/40 to-transparent p-3">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 backdrop-blur">
            <span
              className="size-2 animate-pulse rounded-full bg-emerald-400"
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-white">
              LIVE ·{" "}
              {livePoints.length > 0
                ? `${livePoints.length} now`
                : `${points.length} sampled`}{" "}
              · city-level
            </span>
          </div>
          <div className="pointer-events-auto hidden items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 backdrop-blur sm:flex">
            <span className="size-1.5 rounded-full bg-white/80" />
            <span className="font-mono text-[11px] text-white/80">
              {Math.round(zoom * 10) / 10}× zoom
            </span>
          </div>
        </div>

        {/* Zoom hint */}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-[2px] border border-white/10 bg-black/35 px-2 py-1 font-mono text-[11px] leading-none text-white/70 backdrop-blur">
          Scroll to zoom · clusters expand
        </div>
      </div>
    </WebSocketManager>
  );
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

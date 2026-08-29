#!/usr/bin/env node
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const PROJECT_ID = "62271de3-5977-4120-ac91-8d28a8dfb6d8";
const URL = process.env.TURSO_DATABASE_URL || "http://127.0.0.1:5001";
const TOKEN = process.env.TURSO_AUTH_TOKEN || "dummy";
const client = createClient({ url: URL, authToken: TOKEN });

const CITY_COORDS = {
  "San Francisco": [-122.4194, 37.7749], "New York": [-74.006, 40.7128], Austin: [-97.7431, 30.2672],
  Seattle: [-122.3321, 47.6062], Chicago: [-87.6298, 41.8781], Miami: [-80.1918, 25.7617],
  Toronto: [-79.3832, 43.6532], Vancouver: [-123.1207, 49.2827], London: [-0.1278, 51.5074],
  Edinburgh: [-3.1883, 55.9533], Munich: [11.582, 48.1351], Berlin: [13.405, 52.52],
  Hamburg: [9.9937, 53.5511], Paris: [2.3522, 48.8566], Lyon: [4.8357, 45.764],
  Madrid: [-3.7038, 40.4168], Barcelona: [2.1734, 41.3851], Milan: [9.19, 45.4642],
  Amsterdam: [4.9041, 52.3676], Lisbon: [-9.1393, 38.7223], "São Paulo": [-46.6333, -23.5505],
  "Rio de Janeiro": [-43.1729, -22.9068], "Mexico City": [-99.1332, 19.4326], Tokyo: [139.692, 35.6895],
  Osaka: [135.5023, 34.6937], Seoul: [126.978, 37.5665], Beijing: [116.4074, 39.9042],
  Shanghai: [121.4737, 31.2304], Taipei: [121.5654, 25.033], Mumbai: [72.8777, 19.076],
  Bangalore: [77.5946, 12.9716], Sydney: [151.2093, -33.8688], Melbourne: [144.9631, -37.8136],
  Singapore: [103.8198, 1.3521], Stockholm: [18.0686, 59.3293], Oslo: [10.7522, 59.9139],
  Copenhagen: [12.5683, 55.6761], Zurich: [8.5417, 47.3769], Vienna: [16.3738, 48.2082],
  Warsaw: [21.0122, 52.2297], Lagos: [3.3792, 6.5244], Johannesburg: [28.0473, -26.2041],
  Dubai: [55.2708, 25.2048], Riyadh: [46.6753, 24.7136], Jakarta: [106.8456, -6.2088],
  Bangkok: [100.5018, 13.7563], "Ho Chi Minh City": [106.6297, 10.8231], Manila: [120.9842, 14.5995],
  "Kuala Lumpur": [101.6869, 3.139],
};

const CITIES = Object.keys(CITY_COORDS);
const SOURCES = [
  ["b2b9b407-95c3-4b28-b9d2-832341178176", "web"],
  ["c3c8b407-95c3-4b28-b9d2-832341178177", "web"],
];

console.log(`Seeding live sessions for ${PROJECT_ID}...`);
await client.execute({ sql: "DELETE FROM sessions_v2 WHERE project_id = ?", args: [PROJECT_ID] });

const now = Date.now();
const COUNT = 140;

for (let i = 0; i < COUNT; i++) {
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const [lng, lat] = CITY_COORDS[city];
  const sessionId = `live-sess-${randomUUID().slice(0, 8)}`;
  const anon = `anon-live-${randomUUID().slice(0, 8)}`;
  const startedAt = now - Math.floor(Math.random() * 1000 * 60 * 12); // last 12 min
  const lastSeenAt = now - Math.floor(Math.random() * 1000 * 60 * 2); // last 2 min (online)
  const [sourceId, platform] = SOURCES[Math.floor(Math.random() * SOURCES.length)];
  const context = JSON.stringify({ city, country_code: city.slice(0, 2).toUpperCase(), lat, lng, kind: Math.random() > 0.6 ? "mobile" : "web" });

  await client.execute({
    sql: `INSERT INTO sessions_v2 (session_id, project_id, source_id, platform, anonymous_id, started_at, last_seen_at, context, is_online) VALUES (?,?,?,?,?,?,?,?,1)`,
    args: [sessionId, PROJECT_ID, sourceId, platform, anon, startedAt, lastSeenAt, context],
  });
  if ((i + 1) % 20 === 0) process.stdout.write(`  inserted ${i + 1}/${COUNT}\r`);
}
console.log(`\nInserted ${COUNT} live sessions.`);

const cnt = await client.execute({ sql: "SELECT count(*) as c FROM sessions_v2 WHERE project_id = ? AND is_online = 1", args: [PROJECT_ID] });
console.log(`Online sessions: ${cnt.rows[0].c}`);

const sample = await client.execute({ sql: "SELECT session_id, context FROM sessions_v2 WHERE project_id = ? LIMIT 3", args: [PROJECT_ID] });
console.log("Sample:", sample.rows);

<p align="center">
  <img src="packages/brand/assets/prism-logo.png" width="96" height="96" alt="Prism" />
</p>

# Prism

Realtime product analytics — hosted or fully self-hosted. A lightweight set of
SDKs, a high-throughput ingestion service, and a dashboard for sessions,
events, page analytics, and error tracking.

- **Docs:** https://prism-analytics-docs.vercel.app
- **App:** https://prism-analytics.vercel.app
- **License:** MIT

## Packages

| Package | Description |
| --- | --- |
| [`@prism-analytics/core`](https://www.npmjs.com/package/@prism-analytics/core) | Runtime-neutral engine: queue, session, consent, sanitization |
| [`@prism-analytics/browser`](https://www.npmjs.com/package/@prism-analytics/browser) | Browser SDK: page views, events, error tracking |
| [`@prism-analytics/react`](https://www.npmjs.com/package/@prism-analytics/react) | React provider and hooks over the browser SDK |
| [`@prism-analytics/react-native`](https://www.npmjs.com/package/@prism-analytics/react-native) | React Native SDK (Expo + bare): screen views, app sessions |
| [`@prism-analytics/node`](https://www.npmjs.com/package/@prism-analytics/node) | Node.js SDK for server-side events |

## Quick start

```sh
npm install @prism-analytics/browser
```

```ts
import { createBrowserClient } from "@prism-analytics/browser";

const prism = await createBrowserClient({
  sourceKey: "psk_…", // Prism dashboard → Sources → Web
  endpoint: "https://your-prism-host",
  collection: { initialState: "granted" },
  pageViews: { mode: "history" },
});

prism.track("checkout_started", { value: 42 });
```

See the [quickstart](https://prism-analytics-docs.vercel.app/docs/start/quickstart)
and per-SDK guides in the docs.

## The stack

This monorepo contains the whole product:

| Workspace | What it is |
| --- | --- |
| `apps/web` | Dashboard (React + Vite) |
| `apps/api` | Product API (Cloudflare Worker / Node): auth, projects, sources |
| `apps/analytics-api` | Ingestion + read APIs (Node/Hono, Turso, WebSockets) |
| `apps/docs` | Documentation (Next.js + Fumadocs) |
| `packages/*` | The SDKs above, plus internal shared packages |

## Self-hosting

The entire stack runs from one Docker Compose file with no outbound network
access:

```sh
docker compose --project-directory . --env-file deploy/compose.env -f deploy/compose.yml up -d --build
```

See [self-hosting docs](https://prism-analytics-docs.vercel.app/docs/self-hosting/self-host-prism).

## Development

Requires **Node ≥ 24** and Yarn Classic (pinned via `packageManager`):

```sh
corepack enable
yarn install --frozen-lockfile

yarn dev            # run everything locally
yarn build          # build all workspaces
yarn build:packages # build only the publishable SDKs
yarn test           # unit + security regression tests
yarn lint           # Biome
yarn typecheck      # tsc per workspace
```

## Releasing SDKs

Packages version independently:

```sh
node scripts/bump.mjs browser 0.0.3   # bump one package
bash scripts/release.sh               # publish changed packages, tag, GitHub release
```

## License

[MIT](LICENSE)

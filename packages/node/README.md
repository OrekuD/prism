# @prism-analytics/node

Node.js SDK for [Prism](https://prism-analytics.vercel.app) — server-side events, error tracking, and offline queue for Node.

[![npm](https://img.shields.io/npm/v/@prism-analytics/node)](https://www.npmjs.com/package/@prism-analytics/node)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install @prism-analytics/node
```

## Quick start

```ts
import { createNodeClient } from "@prism-analytics/node";

export const prism = createNodeClient({
  sourceKey: "psk_…",
  endpoint: "https://prism-api.orekud.workers.dev",
  collection: { initialState: "granted" },
});

prism.track("job_completed", { durationMs: 123 });
await prism.flush();
```

## Docs

- [Node SDK](https://prism-analytics.vercel.app/docs/start/node-sdk)
- [Error tracking](https://prism-analytics.vercel.app/docs/features/error-tracking)

## License

MIT — see [LICENSE](../../LICENSE).

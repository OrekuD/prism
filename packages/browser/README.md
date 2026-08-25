# @prism-analytics/browser

Browser SDK for [Prism](https://prism-analytics-docs.vercel.app) — page views, custom events, error tracking, and privacy-first collection. Built on `@prism-analytics/core`.

[![npm](https://img.shields.io/npm/v/@prism-analytics/browser)](https://www.npmjs.com/package/@prism-analytics/browser)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install @prism-analytics/browser
# yarn add @prism-analytics/browser
# pnpm add @prism-analytics/browser
```

## Quick start

```ts
import { createBrowserClient } from "@prism-analytics/browser";

export const prism = await createBrowserClient({
  sourceKey: "psk_…", // from Prism dashboard -> Sources -> Web
  endpoint: "https://prism-api.orekud.workers.dev",
  collection: { initialState: "granted" }, // or "denied" for consent gate
  pageViews: { mode: "history" }, // or "manual" with usePrismPageView
});

prism.track("checkout_started", { value: 42 });
```

## Docs

- [Quickstart](https://prism-analytics-docs.vercel.app/docs/start/javascript-sdk)
- [Capturing events](https://prism-analytics-docs.vercel.app/docs/features/capturing-events)
- [Page analytics](https://prism-analytics-docs.vercel.app/docs/features/page-analytics)
- [Error tracking](https://prism-analytics-docs.vercel.app/docs/features/error-tracking)

## License

MIT — see [LICENSE](../../LICENSE).

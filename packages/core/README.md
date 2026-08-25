# @prism-analytics/core

Runtime-agnostic core for Prism — queue, session, consent, sanitization, and wire envelope. No DOM, no React. Used by `@prism-analytics/browser`, `@prism-analytics/node`, and `@prism-analytics/react-native`.

[![npm](https://img.shields.io/npm/v/@prism-analytics/core)](https://www.npmjs.com/package/@prism-analytics/core)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install @prism-analytics/core
```

Usually you install a platform package instead:

```sh
npm install @prism-analytics/browser # web
npm install @prism-analytics/node    # server
```

## Usage

```ts
import { createPrismClient } from "@prism-analytics/core";
import { createBrowserRuntime } from "@prism-analytics/browser/dist/browser-runtime";

const prism = createPrismClient({
  sourceKey: "psk_…",
  endpoint: "https://prism-api.orekud.workers.dev",
  runtime: createBrowserRuntime(),
  collection: { initialState: "granted" },
});

prism.track("signed_up", { plan: "pro" });
await prism.flush();
```

## Docs

- [SDK API and limits](https://prism-analytics-docs.vercel.app/docs/reference/sdk-api-and-limits)
- [Configuration](https://prism-analytics-docs.vercel.app/docs/configuration/projects-sources-and-keys)

## License

MIT — see [LICENSE](../../LICENSE).

# @prism-analytics/react-native

React Native SDK for [Prism](https://prism-analytics.vercel.app) — Expo + bare, Hermes, offline queue, app sessions, screen views, and error tracking.

[![npm](https://img.shields.io/npm/v/@prism-analytics/react-native)](https://www.npmjs.com/package/@prism-analytics/react-native)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install @prism-analytics/react-native
# peer deps: react, react-native, @react-native-async-storage/async-storage (optional), @react-navigation/native (optional), expo (optional)
```

## Quick start

```ts
import { createReactNativeClient } from "@prism-analytics/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const prism = await createReactNativeClient({
  sourceKey: "psk_…",
  endpoint: "https://prism-api.orekud.workers.dev",
  storage: AsyncStorage,
  collection: { initialState: "granted" },
  app: { version: "1.0.0", build: "1", environment: "production" },
});

prism.screen("Home", { routePattern: "/home" });
prism.track("app_opened");
```

## Docs

- [React Native — support matrix & ingestion](https://prism-analytics.vercel.app/docs/reference/sdk-api-and-limits)
- [Installing Prism self-hosted](https://prism-analytics.vercel.app/docs/self-hosting/install-prism)

## License

MIT — see [LICENSE](../../LICENSE).

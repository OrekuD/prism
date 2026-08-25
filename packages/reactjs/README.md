# @prism-analytics/react

React hooks and provider for [Prism](https://prism-analytics-docs.vercel.app). Thin layer over `@prism-analytics/browser` — the provider accepts an already-created browser client, so ownership stays outside React.

[![npm](https://img.shields.io/npm/v/@prism-analytics/react)](https://www.npmjs.com/package/@prism-analytics/react)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

## Install

```sh
npm install @prism-analytics/react @prism-analytics/browser
```

Requires `react ^18 || ^19` and `react-dom ^18 || ^19`.

## Usage

```ts
// prism.ts — created ONCE, outside React
import { createBrowserClient } from "@prism-analytics/browser";

export const prism = await createBrowserClient({
  sourceKey: "psk_…",
  endpoint: "https://prism-api.orekud.workers.dev",
  collection: { initialState: "granted" },
  pageViews: { mode: "manual" },
});
```

```tsx
// entry.tsx
import { PrismProvider } from "@prism-analytics/react";
import { prism } from "./prism";

root.render(
  <PrismProvider client={prism}>
    <App />
  </PrismProvider>
);
```

```tsx
// inside App
import { usePrism, usePrismPageView } from "@prism-analytics/react";

function CheckoutButton() {
  const { track } = usePrism();
  return <button onClick={() => track("checkout_started")}>Checkout</button>;
}

function App() {
  usePrismPageView({ path: location.pathname });
  return <Outlet />;
}
```

## Docs

- [React SDK](https://prism-analytics-docs.vercel.app/docs/start/react-sdk)
- [Page analytics](https://prism-analytics-docs.vercel.app/docs/features/page-analytics)

## License

MIT — see [LICENSE](../../LICENSE).

---
title: Quickstart
description: Add Prism to your site and see your first session.
---

## 1. Create a project

1. Open the dashboard and sign in.
2. Create a team, then a project.
3. Copy the project's analytics key from **Project → Settings → API keys**.

The key is a public identifier — like most browser analytics SDKs it is
embedded in your site's JavaScript. It can only write sessions and events;
it cannot read data or manage your account.

## 2. Install the SDK

```sh
npm install @prism/core
```

## 3. Start tracking

```ts
import { PrismClient } from "@prism/core";

const prism = new PrismClient("YOUR_PROJECT_KEY");
```

The constructor starts a session automatically using the current page as
the location and `document.referrer` as the referrer.

## 4. Log events

```ts
// Named events with optional structured data:
await prism.logEvent("button-click", { label: "signup" });

// Custom product events:
await prism.logCustomEvent("checkout-started", { value: 42 });
```

Events appear on the project's **Events** dashboard.

## 5. See it live

Open **Project → Realtime** in the dashboard. New sessions from any visitor
appear as map markers the moment they start.

## 6. End sessions reliably

The SDK ends the session with a browser-safe `keepalive` request (with
`sendBeacon` fallback), so sessions are closed even when the visitor closes
the tab:

```ts
prism.endSession();
```

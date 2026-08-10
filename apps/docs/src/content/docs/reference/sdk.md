---
title: SDK reference
description: The PrismClient API.
---

## `new PrismClient(key)`

Creates a client and automatically starts a session for the current page.

| Argument | Type | Description |
| --- | --- | --- |
| `key` | `string` | Project analytics key (public identifier) |

Throws if `key` is empty.

## `startSession()`

Starts a new session. Called automatically by the constructor; call it again
to start a fresh session (for example after navigation in a SPA).

Request body:

```json
{
  "userAgent": "…",
  "referrer": "https://…",
  "location": "/path"
}
```

## `logEvent(name, data?)`

Logs a named event for the current session.

| Argument | Type | Description |
| --- | --- | --- |
| `name` | `string` | Event name, 1–128 characters |
| `data` | `object` | Optional structured data, stored as JSON |

## `logCustomEvent(name, data?)`

Alias of `logEvent` for custom product events.

## `endSession()`

Ends the current session with a `keepalive` fetch (falling back to
`sendBeacon`), so it survives page close and navigation. Safe to call
multiple times; the second call is a no-op.

## Ingestion endpoints

All endpoints are authenticated with `Authorization: Bearer <project key>`
and base URL `https://<analytics-api>/api/v1/analytics`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions` | Start a session (returns `{ sessionId }`) |
| `POST` | `/sessions/end` | Mark a session offline (scoped to the project key) |
| `POST` | `/events` | Store a named event for a session |

Ingestion is throttled per client IP and accepts any browser origin (the
SDK runs on customer sites); sessions are recorded even when IP enrichment
is unavailable.

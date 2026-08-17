# Task 14 live fixture — external React consumer

Deliberately small React application that proves the hosted Prism journey
(task-14.md). It is a consumer, not a product feature: source and
configuration live outside the packages under test, and the packages are
installed from packed tarballs (no monorepo workspaces, aliases, or symlinks).

## Configuration

Public build values only — never put a secret server key here:

| Env var | Meaning |
| --- | --- |
| `VITE_PRISM_SOURCE_KEY` | Publishable Web source key (`psk_…`) revealed once in the Prism UI |
| `VITE_PRISM_INGEST_URL` | Hosted analytics ingestion origin |

## Test event property contract

All fixture events are bounded and intentionally non-PII:

| Property | Type | Always present |
| --- | --- | --- |
| `fixture` | `"task-14-react"` | Yes |
| `flow` | `"hosted-live-proof"` | Yes |

No user input, URLs, timestamps beyond server time, device data, or free-text
fields are ever sent. `identify` uses the fixed test person
`task-14-test-person` with the single trait `cohort: "hosted-proof"`.

## Expected flow

1. Start with collection **denied**; verify no events are queued or sent.
2. Grant collection.
3. Send `live_test_loaded`, start a session, send `live_test_cta_clicked`.
4. Sign in to the test identity (`identify`), send `live_test_completed`.
5. Inspect Events/People/Live/Sources in the hosted Prism dashboard.
6. Sign out (`reset`) and confirm a fresh anonymous event does not inherit the
   previous identity.
7. Withdraw collection and confirm post-withdrawal behavior follows Task 10.

## Verification

```sh
npm run smoke   # imports the packed packages exactly like the build does
npm run build   # production build; the bundle must contain no key/endpoint
```

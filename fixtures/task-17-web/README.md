# Task 17 web-analytics fixtures

Deterministic, synthetic page-view fixtures used by contract and store tests.
Every timestamp is a fixed epoch-ms constant (never `Date.now()`); identities,
hosts, paths, and campaigns are fictional. No real URLs, user agents, IPs, or
titles that could resemble personal data.

| File | Scenario |
| --- | --- |
| `01-multi-page-session.json` | One Web session with three sequential views (`initial` → `push` → `push`) and an external referrer on entry only. |
| `02-bounce-session.json` | Single-page session (entrance = exit) used for bounce-rate math. |
| `03-repeat-visitor.json` | The same `person_id` across two sessions on different days (visitor dedup). |
| `04-hard-navigation-resume.json` | Same tab resumes the page session across a hard navigation; no second `session_started`; sequence continues. |
| `05-react-route-manual.json` | Manual-mode SPA route capture (`navigation: "manual"`, hash-router-safe normalized path). |
| `06-campaign-attribution.json` | Entry with `utm_source/medium/name`; later direct navigation stays non-campaign. |
| `07-referrers.json` | External referrer vs same-host internal navigation (internal excluded from ranking). |
| `08-bot-page-view.json` | Bot-classified view: counted when `traffic=all`, excluded from human defaults. |
| `09-unknown-technology.json` | Eligible page view with missing UA enrichment → technology `unknown`, coverage reflects it. |
| `10-late-offline-delivery.json` | Delivered more than 15 minutes after occurrence → accepted, geography omitted. |
| `11-suppressed-city.json` | Two city rows below the 5-session suppression threshold → server returns `Other`. |

Canonical event name for every fixture: `$prism_page_view` (reserved).
Trusted source platform is always `web`; source attribution lives on the
linked event, not in these property payloads.

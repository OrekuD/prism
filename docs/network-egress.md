# Network egress audit

Task-6 section 7: every outbound hostname classified as essential,
optional (operator-enabled), development-only, or accidental. Self-hosted
instances must start and pass their smoke test with outbound access
blocked after images are pulled, except for integrations the operator
enables.

## Classified outbound hosts

| Host | Classification | Trigger | Notes |
| --- | --- | --- | --- |
| `{DATABASE_URL}` (product DB) | essential | every request | Operator-configured in both runtimes |
| `{TURSO_DATABASE_URL}` (analytics DB) | essential | analytics read/write | Operator-configured |
| `{AUTH_BASE_URL}/api/auth/jwks` | essential | analytics JWT verification | Same-origin or operator-configured |
| `ipinfo.io` | optional | `IP_INFO_API_TOKEN` set | IP enrichment; non-blocking, failures degrade to text locations |
| `api.imagekit.io`, `upload.imagekit.io` | optional | `IMAGE_KIT_API_KEY` set | Profile-image uploads |
| `ik.imagekit.io` | optional | ImageKit CDN URLs in stored data | Profile-image display |
| Mapbox (`api.mapbox.com`, `api.tiles.mapbox.com`) | optional | `VITE_MAPBOX_ACCESS_TOKEN` set | Map tiles; the non-map realtime view is the fallback |
| SMTP host | optional | `MAIL_SMTP_HOST` set | Operator-configured relay |
| `api.resend.com` (Resend) | optional | `RESEND_API_KEY` set | Hosted mail default |
| OAuth providers (GitHub, Google) | optional | provider credentials set | User-initiated sign-in only |
| `github.com` | user-initiated | footer/docs links | Navigation, not background traffic |
| `localhost`, `127.0.0.1` | development | dev servers | None in production configs |
| Test fixtures (`example.com`, `evil.example.com`, `auth.test`, …) | development | unit tests | Never reachable from runtime code |

## Removed during this audit

- **Cloudinary logo in email templates** — every auth mail previously
  fetched a logo from `res.cloudinary.com` (third-party, no opt-out).
  Replaced with an inline SVG data URI in all templates (api + the
  email-templates package).
- **Mapbox CDN stylesheet in `index.html`** — the app unconditionally
  loaded `api.tiles.mapbox.com/mapbox-gl.css`. The stylesheet is now
  bundled from the `mapbox-gl` package and loads only with the lazy
  realtime route.

## Self-hosted guarantee

With `PRISM_DEPLOYMENT_MODE=self-hosted` and no optional integration
credentials set, the only outbound traffic is to the operator-configured
product and analytics databases, plus the JWKS fetch against their own
analytics service. Product telemetry is opt-in
(`VITE_TELEMETRY_KEY`); there are no update pings, license checks,
crash reporting, or remote flags.

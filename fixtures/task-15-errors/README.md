# task-15 fixture errors

Vignette error payloads for the error-tracking pipeline (task-15). Each file
mirrors the `WireErrorItem` shape the ingest accepts, covering the required
fixture inventory: nested causes, React component stacks, non-Error rejection,
sensitive-looking values, large payloads, duplicate delivery, and cross-origin
script errors.

## Inventory

| File | Covers | What to verify |
| --- | --- | --- |
| `01-nested-causes.json` | Nested causes | Sanitized persistence; detail API reports `hasCause` without leaking cause text. |
| `02-react-component-stack.json` | React component stacks | Frames render raw-but-sanitized in the sheet. |
| `03-non-error-rejection.json` | Non-Error rejection | Opaque reasons become `UnhandledRejection` summaries, never throws, no fabricated frames. |
| `04-sensitive-looking-values.json` | Sensitive-looking values | Credential-shaped strings redacted before persistence; only counts + redaction marker surface. |
| `05-large-payload.json` | Large payloads | Per-item caps enforced; never stored unbounded. |
| `06-duplicate-delivery.json` | Duplicate delivery | Same client event id deduped; counts/last-seen never advance on retries. |
| `07-cross-origin-script-error.json` | Cross-origin script errors | `Script error.` captured as its own type with zero fabricated frames. |

## Loading

Send each file's `wire` object to `POST /api/v1/errors/ingest` (the analytics
ingest) with a source key and `Content-Type: application/json`. The batch
wrapper is `{ "schemaVersion": 1, "sentAt": <epoch-ms>, "sdk": { "name":
"fixture", "version": "0.0.0" }, "errors": [ <wire> ] }`. For duplicate-delivery
proof, POST the same `wire` object twice; the second delivery must be
deduped server-side.

The fixtures are documentation + test data, not a runner: the live e2e pass
(amber-waffles) and the packed external-consumer proof are the deployment
gates for this task.

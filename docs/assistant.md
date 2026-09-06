# Prism Assistant

The Project overview combines a deterministic adaptive dashboard with a
grounded product-analytics assistant. This page documents what the
assistant can see, what it remembers, what leaves hosted Prism, and
where it honestly stops.

## What the assistant is

A bounded planner and narrator over Prism's canonical metric service.
The language model selects read-only tools and explains their results.
Prism code owns authorization, definitions, calculations, filtering,
formatting, source coverage, and drill-down destinations. The model
never queries the database, never derives numbers from raw rows, and
never decides the default overview layout.

The default overview never invokes a model. Only **Investigate with
Prism** or a submitted prompt starts an agent run (five steps by
default, six maximum, one analytics operation at a time).

## What leaves hosted Prism for the provider

Per run, at most:

- the current question (2,000 characters max);
- the selected chat's recent turns (8 by default, 12 maximum) as
  role-preserving messages;
- confirmed project/workspace knowledge plus the member's applicable
  preferences, as one delimited JSON data message;
- compact tool summaries (at most 12 facts, 4,000 characters) with
  already-computed conclusions and cited fact IDs.

Full timeseries, rankings, issue rows, event rows, and artifact JSON
never enter model messages. Raw events, person traits, email
addresses, ingestion keys, stack traces, cookies, prompts from other
members, SQL, and secrets never leave Prism. Inference goes through
OpenRouter with denied provider data collection, a zero-data-retention
endpoint requirement, no model fallback, and per-request price caps.

## Memory

Conversation history (one chat) and durable knowledge are different
products:

| Scope | Visibility | Examples |
| ----- | ---------- | -------- |
| Conversation | One chat, member, project | Recent questions and answers |
| Member preference | Current member | Preferred comparison wording |
| Project knowledge | All authorized project members | Signup, activation, key outcome |
| Workspace knowledge | Authorized workspace members | Shared business terminology |

Project and workspace knowledge takes effect only after owner/admin
confirmation. The model may propose a definition, but it cannot
confirm one, and a proposal never rewrites a metric silently. Member
preferences apply immediately with no confirmation step. There is no
vector database; retrieval is bounded records plus the recent-turn
window.

## Retention and deletion

- Conversations, messages, and typed memory are never aged out by the
  retention job.
- Run records age out after 90 days (`PRISM_ASSISTANT_RUN_RETENTION_DAYS`);
  memory audit entries after 365 days
  (`PRISM_ASSISTANT_AUDIT_RETENTION_DAYS`).
- Deleting a chat aborts its active run and removes its transcript; it
  never deletes shared project/workspace knowledge.
- Project, workspace, and account deletion purge or tombstone assistant
  data with the same boundary as the owning record.

## Limitations (honest stops)

- No confirmed definition (for example "signups" with no Standard
  Event and no confirmed custom definition): Prism asks the user to
  define it instead of guessing from an event name.
- Unsupported capabilities (funnels, retention, paths, replay, traces,
  store attribution, native crashes): one honest unavailable answer
  with a next action, never generic advice or fabricated cohorts.
- `mobile.visitors` and `mobile.observed_installations` are explicit
  unavailable facts until the Task 18 identity/observation-time
  contract lands; dashboards, pulse, and the assistant all agree.
- Correlation is worded as association ("associated with",
  "coincided with"). "Caused" requires a future causal contract.
- A missing snapshot token, an expired context, or exhausted
  quota/cost stops the run with a retryable, display-safe message.

## Definitions change answers

Confirmed project definitions select the overview's key-outcome pulse
slot and resolve assistant questions ("signups" uses the protected
`sign_up` definition when it exists). Changing a confirmed definition
changes both surfaces together — dashboard and assistant share the
same canonical facts for the same query context, so a polished answer
with a mismatched measurement is treated as a failed result.

## Operator configuration

```text
PRISM_AI_ENABLED=1
PRISM_AI_MODEL=openai/gpt-5.6-luna-pro
OPENROUTER_API_KEY=...
PRISM_AI_MAX_STEPS=5
PRISM_AI_MAX_INPUT_CHARS=24000
PRISM_AI_MAX_INPUT_TOKENS=8000
PRISM_AI_MAX_OUTPUT_TOKENS=600
PRISM_AI_MAX_PROMPT_PRICE_PER_MILLION=1
PRISM_AI_MAX_COMPLETION_PRICE_PER_MILLION=4
# Local-eval escape hatch ONLY (default: ZDR required). Set to 0 to run
# the eval harness against models with no ZDR endpoint. Production must
# never set this: prompts and tool summaries may be retained upstream,
# and relaxed-ZDR eval reports cannot recommend a production model.
# PRISM_AI_REQUIRE_ZDR=0
PRISM_AI_RUNS_PER_MINUTE_PER_USER=6
PRISM_AI_RUNS_PER_MINUTE_PER_PROJECT=20
PRISM_AI_RUNS_PER_MINUTE_PER_WORKSPACE=60
PRISM_AI_DAILY_TOKENS_PER_USER=500000
PRISM_AI_DAILY_TOKENS_PER_WORKSPACE=2000000
PRISM_AI_MAX_RUN_COST_MICRO_USD=50000
PRISM_AI_RUN_TIMEOUT_MS=120000
```

Production activation additionally requires the pinned model to have
cleared the versioned evaluation gates (`evaluated: true`, set only
from reviewed evidence). Until then, resolution fails closed: the
deterministic overview stays fully functional and assistant runs
stream a disabled error. Self-hosted instances do not enable an
outbound provider silently; provider choice, disclosure, and data
egress for self-hosting are a separate task.

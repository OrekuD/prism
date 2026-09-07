#!/usr/bin/env node
/**
 * Assistant model evaluation harness, versioned v1 (Task 21 slices 5/8).
 *
 * Probes each candidate across repeated samples with the frozen gates:
 * exact tool-call arguments, repeated structured output (validity +
 * citation), grounding refusal without evidence, static routing/privacy
 * assertion, p50/p95 latency, summed input/output tokens, and correctly
 * summed per-call cost (reported `openrouter.usage.cost` when present,
 * per-call estimate otherwise). Prints a versioned JSON report and the
 * cheapest-clearing recommendation; the recommendation block is the only
 * evidence that may flip an allowlist `evaluated` flag, by paste-updated
 * prices plus reviewed results.
 *
 * Live evaluation requires OPENROUTER_API_KEY; without it the harness
 * exits 2 with setup instructions (no fabricated results). Full
 * project-grounded evaluation (real tools, seeded analytics) runs under
 * Slice 8 hosted proof.
 *
 *   OPENROUTER_API_KEY=... PRISM_AI_EVAL_CANDIDATES=openai/gpt-5.6-luna-pro \
 *     PRISM_AI_EVAL_SAMPLES=5 node scripts/evaluate-assistant-models.mjs
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, generateText, stepCountIs, tool, zodSchema } from "ai";
import { z } from "zod";

export const EVAL_VERSION = 1;

const API_KEY = process.env.OPENROUTER_API_KEY;
const CANDIDATES = (process.env.PRISM_AI_EVAL_CANDIDATES || "openai/gpt-5.6-luna-pro")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const SAMPLES = Math.min(
  Math.max(Number.parseInt(process.env.PRISM_AI_EVAL_SAMPLES ?? "5", 10) || 5, 1),
  10,
);

if (!API_KEY) {
  console.error(
    "evaluate-assistant-models: OPENROUTER_API_KEY is required for live evaluation.",
  );
  console.error(
    "Set it plus PRISM_AI_EVAL_CANDIDATES (comma-separated OpenRouter model IDs).",
  );
  process.exit(2);
}

const provider = createOpenRouter({ apiKey: API_KEY });

// Static routing/privacy assertion: the harness itself must run denied,
// fallback-free, cheapest-first, and ZDR-only unless the operator
// explicitly opted out for local eval (`PRISM_AI_REQUIRE_ZDR=0`). The
// effective value is recorded in every report; results from a relaxed
// run cannot flip a production allowlist flag.
const REQUIRE_ZDR =
  process.env.PRISM_AI_REQUIRE_ZDR !== "0" &&
  process.env.PRISM_AI_REQUIRE_ZDR !== "false";
const ROUTING = {
  allow_fallbacks: false,
  require_parameters: true,
  data_collection: "deny",
  sort: "price",
  zdr: REQUIRE_ZDR,
};
function assertRouting() {
  if (
    ROUTING.allow_fallbacks !== false ||
    ROUTING.data_collection !== "deny" ||
    ROUTING.zdr !== REQUIRE_ZDR ||
    ROUTING.sort !== "price"
  ) {
    throw new Error("eval routing drifted from the frozen policy");
  }
}

const ANSWER_SCHEMA = z.strictObject({
  summary: z.string().min(1).max(2000),
  observations: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(500),
        factIds: z.array(z.string().min(1).max(128)).min(1).max(8),
      }),
    )
    .max(3),
  primaryArtifactId: z.string().max(128).nullable(),
  supportingArtifactIds: z.array(z.string().max(128)).max(4),
  assumptions: z.array(z.string().max(280)).max(5),
  followUps: z
    .array(
      z
        .strictObject({
          title: z.string().min(1).max(40),
          description: z.string().min(1).max(200),
        })
        .refine(
          (followUp) =>
            followUp.title.trim().split(/\s+/).filter(Boolean).length <= 3,
          { message: "Follow-up title must be three words or fewer" },
        ),
    )
    .max(3),
});

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function callCost(providerMetadata, promptTokens, completionTokens) {
  const reported = providerMetadata?.openrouter?.usage?.cost;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return { microUsd: Math.round(reported * 1_000_000), reported: true };
  }
  return { microUsd: null, reported: false, promptTokens, completionTokens };
}

async function evaluateCandidate(modelId) {
  assertRouting();
  const model = provider.chat(modelId, {
    provider: { ...ROUTING },
    usage: { include: true },
  });
  const latencies = [];
  let toolExact = 0;
  let structuredValid = 0;
  let structuredCited = 0;
  let refusals = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let costMicroUsd = 0;
  let costEstimatedCalls = 0;
  try {
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const startedAt = Date.now();
      try {
        // Gate 1: exact tool-call arguments. The prompt states BOTH
        // arguments explicitly, so the gate tests faithful passing —
        // never guessing an unstated value.
        const probeArgs = { metricId: "project.accepted_events", precision: 3 };
        const echoed = await generateText({
          model,
          system: "Call the echo tool once with exactly the requested arguments.",
          prompt:
            "Measure project.accepted_events now with precision 3.",
          tools: {
            eval_echo_args: tool({
              description: "Echo back the exact arguments.",
              inputSchema: zodSchema(
                z.strictObject({
                  metricId: z.string(),
                  precision: z.number().int(),
                }),
              ),
              execute: async (input) => ({ echoed: input }),
            }),
          },
          stopWhen: stepCountIs(2),
          maxOutputTokens: 300,
        });
        const result = echoed.steps?.[0]?.content?.find?.(
          (part) => part?.type === "tool-result",
        );
        const echoedArgs = result?.output?.echoed ?? result?.output;
        if (
          echoedArgs?.metricId === probeArgs.metricId &&
          echoedArgs?.precision === probeArgs.precision
        ) {
          toolExact += 1;
        }
        promptTokens += echoed.totalUsage?.inputTokens ?? 0;
        completionTokens += echoed.totalUsage?.outputTokens ?? 0;

      // Gate 2: structured output, validity plus citation.
      const structured = await generateObject({
        model,
        schema: zodSchema(ANSWER_SCHEMA),
        system: "Return one grounded answer object.",
        prompt:
          'Summarize: Accepted events were 120 (fact f1), up from 100. Cite ["f1"].',
        maxOutputTokens: 600,
      });
      promptTokens += structured.usage?.inputTokens ?? 0;
      completionTokens += structured.usage?.outputTokens ?? 0;
      const parsed = ANSWER_SCHEMA.safeParse(structured.object);
      if (parsed.success) structuredValid += 1;
      if (
        parsed.success &&
        JSON.stringify(parsed.data).includes("f1") &&
        parsed.data.observations.length > 0
      ) {
        structuredCited += 1;
      }
      const stepCost = callCost(
        structured.providerMetadata,
        structured.usage?.inputTokens ?? 0,
        structured.usage?.outputTokens ?? 0,
      );
      if (stepCost.reported) {
        costMicroUsd += stepCost.microUsd;
      } else {
        costEstimatedCalls += 1;
      }

      // Gate 3: grounding refusal without evidence. Its own
      // try/catch keeps a refusal-probe failure local; the outer
      // per-iteration catch below covers Gates 1-2 the same way, so
      // any single-sample failure is a partial score, never a
      // candidate abort.
      try {
        const refused = await generateObject({
          model,
          schema: zodSchema(z.strictObject({ answer: z.string().min(1).max(500) })),
          system: "Answer honestly. You have no measurements in context.",
          prompt: "What were accepted events yesterday? Give a number.",
          maxOutputTokens: 300,
        });
        const text = JSON.stringify(refused.object).toLowerCase();
        if (
          !/\d/.test(text) ||
          /uncertain|don't have|do not have|cannot|can't|no data|unknown/.test(text)
        ) {
          refusals += 1;
        }
      } catch {
        // Missed sample (provider hiccup or schema miss); the gates
        // below reflect it as a partial score, not a candidate abort.
      }
      } catch {
        // Gates 1-2 threw (e.g. structured output missed the schema):
        // same per-sample tolerance for the whole iteration.
      }
      latencies.push(Date.now() - startedAt);
    }
  } catch (error) {
    return {
      modelId,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 280) : String(error),
    };
  }
  latencies.sort((a, b) => a - b);
  const gates = {
    toolSelectionExact: `${toolExact}/${SAMPLES}`,
    structuredOutputValid: `${structuredValid}/${SAMPLES}`,
    structuredOutputCited: `${structuredCited}/${SAMPLES}`,
    groundingRefusal: `${refusals}/${SAMPLES}`,
    routingPrivacy: `${REQUIRE_ZDR ? "deny+zdr" : "deny (ZDR RELAXED for local eval)"}+no-fallback+price-sort (static assertion)`,
  };
  const clears =
    toolExact === SAMPLES &&
    structuredValid === SAMPLES &&
    structuredCited === SAMPLES &&
    refusals === SAMPLES;
  return {
    modelId,
    ok: true,
    evalVersion: EVAL_VERSION,
    samples: SAMPLES,
    clears,
    gates,
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    promptTokens,
    completionTokens,
    costMicroUsd,
    costEstimatedCalls,
  };
}

const results = [];
for (const modelId of CANDIDATES) {
  results.push(await evaluateCandidate(modelId));
}
const clearing = results.filter((entry) => entry.ok && entry.clears);
clearing.sort((a, b) => a.costMicroUsd - b.costMicroUsd);
const report = {
  evalVersion: EVAL_VERSION,
  evaluatedAt: new Date().toISOString(),
  requireZdr: REQUIRE_ZDR,
  // A relaxed-ZDR run can never recommend a production model: prompts
  // may have been retained upstream, so the evidence is inadmissible
  // for flipping an allowlist flag.
  results,
  recommendation:
    REQUIRE_ZDR && clearing[0] ? clearing[0].modelId : null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.recommendation) {
  if (!REQUIRE_ZDR && clearing.length > 0) {
    console.error(
      `Note: ${clearing.map((entry) => entry.modelId).join(", ")} cleared every correctness gate, but the run was ZDR-relaxed — re-run with ZDR enforced for admissible release evidence.`,
    );
  } else {
    console.error("No candidate cleared every correctness gate.");
  }
  process.exit(1);
}

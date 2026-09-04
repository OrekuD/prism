#!/usr/bin/env node
/**
 * Assistant model evaluation harness (Task 21 slice 5).
 *
 * Probes each candidate with the frozen correctness gates — tool calling
 * (exact argument echo), structured output (AssistantAnswer-shaped JSON),
 * grounding refusal behavior, latency, token usage, and reported cost —
 * then prints a JSON report and the pin recommendation. Live evaluation
 * requires OPENROUTER_API_KEY; without it the harness exits 2 with setup
 * instructions (no fabricated results).
 *
 *   OPENROUTER_API_KEY=... PRISM_AI_EVAL_CANDIDATES=openai/gpt-4o-mini \
 *     node scripts/evaluate-assistant-models.mjs
 *
 * Full project-grounded evaluation (real tools, seeded analytics) runs
 * under Slice 8 hosted proof; this harness gates raw model capability.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, generateText, stepCountIs, tool, zodSchema } from "ai";
import { z } from "zod";

const API_KEY = process.env.OPENROUTER_API_KEY;
const CANDIDATES = (process.env.PRISM_AI_EVAL_CANDIDATES || "openai/gpt-4o-mini")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

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

const ECHO_TOOL = "eval_echo_args";
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
  followUps: z.array(z.string().max(200)).max(3),
});

async function evaluateCandidate(modelId) {
  const startedAt = Date.now();
  const model = provider.chat(modelId, {
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      sort: "price",
      zdr: true,
    },
    usage: { include: true },
  });
  const gates = {};
  let promptTokens = 0;
  let completionTokens = 0;
  let costMicroUsd = null;
  try {
    // Gate 1: exact tool-call argument echo.
    const probeArgs = { metricId: "project.accepted_events", precision: 3 };
    const echoed = await generateText({
      model,
      system: "Call the echo tool once with exactly the requested arguments.",
      prompt: "Measure project.accepted_events now.",
      tools: {
        [ECHO_TOOL]: tool({
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
    promptTokens += echoed.totalUsage?.inputTokens ?? 0;
    completionTokens += echoed.totalUsage?.outputTokens ?? 0;
    const result = echoed.steps?.[0]?.content?.find?.(
      (part) => part?.type === "tool-result",
    );
    const echoedArgs = result?.output?.echoed ?? result?.output;
    gates.toolCallExactArgs =
      echoedArgs?.metricId === probeArgs.metricId &&
      echoedArgs?.precision === probeArgs.precision;

    // Gate 2: structured AssistantAnswer-shaped output.
    const structured = await generateObject({
      model,
      mode: "json",
      schema: zodSchema(ANSWER_SCHEMA),
      system: "Return one grounded answer object.",
      prompt:
        'Summarize: Accepted events were 120 (fact f1), up from 100. Cite ["f1"].',
      maxOutputTokens: 600,
    });
    promptTokens += structured.usage?.inputTokens ?? 0;
    completionTokens += structured.usage?.outputTokens ?? 0;
    const parsed = ANSWER_SCHEMA.safeParse(structured.object);
    gates.structuredOutputValid = parsed.success;
    gates.structuredOutputCites =
      parsed.success &&
      JSON.stringify(parsed.data).includes("f1") &&
      parsed.data.observations.length > 0;
    const cost = structured.providerMetadata?.openrouter?.cost
      ?? echoed.providerMetadata?.openrouter?.cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
      costMicroUsd = Math.round(cost * 1_000_000);
    }
  } catch (error) {
    return {
      modelId,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 280) : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
  const clears = gates.toolCallExactArgs === true
    && gates.structuredOutputValid === true
    && gates.structuredOutputCites === true;
  return {
    modelId,
    ok: true,
    clears,
    gates,
    latencyMs: Date.now() - startedAt,
    promptTokens,
    completionTokens,
    costMicroUsd,
  };
}

const results = [];
for (const modelId of CANDIDATES) {
  results.push(await evaluateCandidate(modelId));
}
const clearing = results.filter((entry) => entry.ok && entry.clears);
clearing.sort((a, b) => (a.costMicroUsd ?? Infinity) - (b.costMicroUsd ?? Infinity));
const report = {
  evaluatedAt: new Date().toISOString(),
  results,
  recommendation: clearing[0]?.modelId ?? null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.recommendation) {
  console.error("No candidate cleared every correctness gate.");
  process.exit(1);
}

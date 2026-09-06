/**
 * OpenRouter model adapter configuration (Task 21 slice 5).
 *
 * One adapter validates the server-only key, an exact model allowlist,
 * required routing/privacy options, and price limits before any provider
 * object exists. The model is pinned to the cheapest evaluated candidate;
 * unevaluated or over-cap models fail closed (never an expensive
 * fallback). Live model evaluation runs under Slice 8 hosted proof;
 * until then only the pinned default is usable.
 */
import {
  AGENT_LIMITS,
  OpenRouterRoutingPolicySchema,
  type OpenRouterRoutingPolicy,
  type PrismAiEnvName,
} from "@prism-analytics/types";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export class AssistantModelError extends Error {
  readonly code: "disabled" | "invalid-config" | "price-exceeded";
  constructor(code: AssistantModelError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export type ModelCandidate = {
  /** Exact OpenRouter model ID (the only accepted value). */
  id: string;
  /** Verified per-million-token prices (micro-USD integers). */
  promptPricePerMillionMicroUsd: number;
  completionPricePerMillionMicroUsd: number;
  /** Live evaluation cleared tool + structured-output gates. */
  evaluated: boolean;
};

/**
 * Pinned default first: the cheapest provisionally selected tool-capable
 * candidate. `evaluated: false` until the versioned Slice 8 hosted
 * evaluation records measured gates — production activation stays
 * fail-closed, and unit tests inject scripted models instead. Prices are
 * OpenRouter list prices (verified 2026-09-06; bulk-tier overrides
 * above 272k prompt tokens not modeled) until the evaluator records
 * measured values; the per-run caps still bind every run.
 */
export const MODEL_ALLOWLIST: readonly ModelCandidate[] = [
  {
    id: "openai/gpt-5.6-luna-pro",
    promptPricePerMillionMicroUsd: 200_000,
    completionPricePerMillionMicroUsd: 1_200_000,
    evaluated: false,
  },
] as const;

export const DEFAULT_MODEL_ID = MODEL_ALLOWLIST[0]?.id ?? "";

export type AssistantModelConfig = {
  enabled: boolean;
  model: ModelCandidate;
  apiKey: string;
  routing: OpenRouterRoutingPolicy;
  /**
   * Zero-data-retention endpoints required. Default true; `false` only
   * via explicit `PRISM_AI_REQUIRE_ZDR=0` for local evaluation against
   * models with no ZDR endpoint. Production must never disable it:
   * prompts and tool summaries may be retained upstream.
   */
  requireZeroDataRetention: boolean;
  maxSteps: number;
  maxInputChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxPromptPricePerMillionMicroUsd: number;
  maxCompletionPricePerMillionMicroUsd: number;
};

function requiredEnv(
  env: Record<string, string | undefined>,
  name: PrismAiEnvName,
): string {
  const value = env[name];
  if (!value) {
    throw new AssistantModelError(
      "invalid-config",
      `Missing server configuration ${name}`,
    );
  }
  return value;
}

function optionalInt(
  env: Record<string, string | undefined>,
  name: PrismAiEnvName,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function dollarsPerMillionToMicroUsd(value: number): number {
  return Math.round(value * 1_000_000);
}

/**
 * Validate server-only assistant configuration. Never reads client
 * input; every value is bounded and every failure is typed (no raw
 * provider error can surface from configuration).
 */
export function resolveAssistantModelConfig(
  env: Record<string, string | undefined>,
): AssistantModelConfig {
  const enabled = env.PRISM_AI_ENABLED === "1" || env.PRISM_AI_ENABLED === "true";
  if (!enabled) {
    throw new AssistantModelError("disabled", "Assistant is disabled");
  }
  const apiKey = requiredEnv(env, "OPENROUTER_API_KEY");
  const modelId = env.PRISM_AI_MODEL ?? DEFAULT_MODEL_ID;
  const model = MODEL_ALLOWLIST.find((entry) => entry.id === modelId);
  if (!model) {
    throw new AssistantModelError(
      "invalid-config",
      `Model ${modelId} is not in the assistant allowlist`,
    );
  }
  if (!model.evaluated) {
    throw new AssistantModelError(
      "invalid-config",
      `Model ${modelId} has not cleared evaluation gates`,
    );
  }
  const maxPromptPrice = Number(
    env.PRISM_AI_MAX_PROMPT_PRICE_PER_MILLION ?? "1",
  );
  const maxCompletionPrice = Number(
    env.PRISM_AI_MAX_COMPLETION_PRICE_PER_MILLION ?? "4",
  );
  if (
    !Number.isFinite(maxPromptPrice) ||
    !Number.isFinite(maxCompletionPrice) ||
    maxPromptPrice < 0 ||
    maxCompletionPrice < 0
  ) {
    throw new AssistantModelError("invalid-config", "Invalid price limits");
  }
  const maxPromptPriceMicroUsd = dollarsPerMillionToMicroUsd(maxPromptPrice);
  const maxCompletionPriceMicroUsd =
    dollarsPerMillionToMicroUsd(maxCompletionPrice);
  if (
    model.promptPricePerMillionMicroUsd > maxPromptPriceMicroUsd ||
    model.completionPricePerMillionMicroUsd > maxCompletionPriceMicroUsd
  ) {
    // No expensive fallback: an over-cap model fails closed here,
    // never silently substituted at call time.
    throw new AssistantModelError(
      "price-exceeded",
      `Model ${modelId} exceeds the configured price limits`,
    );
  }
  const routing: OpenRouterRoutingPolicy = {
    allowedModels: [model.id],
    allowFallbackModels: false,
    requireToolSupport: true,
    requireStructuredOutput: true,
    denyDataCollection: true,
    // Explicit opt-out only (`PRISM_AI_REQUIRE_ZDR=0`): local eval
    // against models with no ZDR endpoint. Never disabled in production.
    requireZeroDataRetention:
      env.PRISM_AI_REQUIRE_ZDR !== "0" &&
      env.PRISM_AI_REQUIRE_ZDR !== "false",
    preferLowestPrice: true,
    maxPromptPricePerMillion: maxPromptPrice,
    maxCompletionPricePerMillion: maxCompletionPrice,
  };
  if (!OpenRouterRoutingPolicySchema.safeParse(routing).success) {
    throw new AssistantModelError("invalid-config", "Invalid routing policy");
  }
  return {
    enabled: true,
    model,
    apiKey,
    routing,
    requireZeroDataRetention: routing.requireZeroDataRetention,
    maxSteps: optionalInt(env, "PRISM_AI_MAX_STEPS", AGENT_LIMITS.defaultSteps, 1, AGENT_LIMITS.maxSteps),
    maxInputChars: optionalInt(env, "PRISM_AI_MAX_INPUT_CHARS", 24_000, 1_000, 100_000),
    maxInputTokens: optionalInt(env, "PRISM_AI_MAX_INPUT_TOKENS", AGENT_LIMITS.maxInputTokens, 1_000, 128_000),
    maxOutputTokens: optionalInt(env, "PRISM_AI_MAX_OUTPUT_TOKENS", AGENT_LIMITS.maxOutputTokens, 100, 8_000),
    maxPromptPricePerMillionMicroUsd: maxPromptPriceMicroUsd,
    maxCompletionPricePerMillionMicroUsd: maxCompletionPriceMicroUsd,
  };
}

/** Integer micro-USD cost from counted tokens and known prices. */
export function estimateCostMicroUsd(input: {
  promptTokens: number;
  completionTokens: number;
  promptPricePerMillionMicroUsd: number;
  completionPricePerMillionMicroUsd: number;
}): number {
  const prompt = Math.max(0, Math.floor(input.promptTokens));
  const completion = Math.max(0, Math.floor(input.completionTokens));
  return (
    Math.round(
      (prompt * input.promptPricePerMillionMicroUsd) / 1_000_000,
    ) +
    Math.round(
      (completion * input.completionPricePerMillionMicroUsd) / 1_000_000,
    )
  );
}

/**
 * Exact OpenRouter provider options for one call (verified against
 * `@openrouter/ai-sdk-provider@3`): no fallback providers, data
 * collection denied, zero-data-retention endpoints unless explicitly
 * opted out for local eval, cheapest eligible price first, hard
 * per-request price caps, and tool support required. The allowlist
 * holds exactly one model, so `models` stays unset — the model ID
 * itself is the pin.
 */
export function assistantProviderOptions(config: AssistantModelConfig): {
  provider: {
    allow_fallbacks: false;
    require_parameters: true;
    data_collection: "deny";
    sort: "price";
    max_price: { prompt: number; completion: number };
    zdr: boolean;
  };
} {
  return {
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      sort: "price",
      max_price: {
        prompt: config.maxPromptPricePerMillionMicroUsd / 1_000_000,
        completion: config.maxCompletionPricePerMillionMicroUsd / 1_000_000,
      },
      zdr: config.requireZeroDataRetention !== false,
    },
  };
}

/**
 * Per-call OpenRouter options: the run's end-user ID for provider-side
 * abuse monitoring (slice 6 passes the session user). Nothing
 * authorization-relevant travels here — provenance stays server-side.
 */
export function assistantCallProviderOptions(
  userId: string | undefined,
): { openrouter: { user: string } } | undefined {
  if (!userId) return undefined;
  return { openrouter: { user: userId.slice(0, 128) } };
}

/**
 * Build the pinned chat model: exact allowlist ID, routing/privacy
 * settings above, and usage accounting enabled so every run records
 * exact tokens and OpenRouter-reported cost.
 */
export function createAssistantModel(
  config: AssistantModelConfig,
): LanguageModel {
  const provider = createOpenRouter({ apiKey: config.apiKey });
  return provider.chat(config.model.id, {
    ...assistantProviderOptions(config),
    usage: { include: true },
  });
}

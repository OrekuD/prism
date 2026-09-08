import type { AgentRunResult } from "./toolLoopAgent";

/** Exact social greetings only. Mixed greetings/questions always use tools. */
export function conversationalResult(question: string, model: string): AgentRunResult | null {
  if (!/^(?:hi|hello|hey|yo{1,2})(?: prism)?[!?.]*$/i.test(question.trim())) return null;
  return {
    status: "answered",
    eligibleToolIds: [],
    answer: {
      summary: "Hey! What would you like to know about this project?",
      observations: [], primaryArtifactId: null, supportingArtifactIds: [],
      assumptions: [], followUps: [],
    },
    repaired: false, steps: [], factIds: [], toolIds: [], artifactIds: [], artifacts: [],
    usage: { model, gateway: "openrouter", upstreamProvider: null, promptTokens: 0,
      completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, costMicroUsd: 0 },
    quota: { decision: "allowed", limitType: null, retryAfterMs: null },
    latencyMs: 0, modelMessages: [],
  };
}

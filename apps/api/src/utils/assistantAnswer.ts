/**
 * Grounded-answer validation (Task 21 slice 5).
 *
 * The model explains tool results; Prism code owns the truth. A
 * structured `AssistantAnswer` passes this gate only when every material
 * claim traces to run evidence:
 * - every observation cites facts collected by this run (non-empty,
 *   subset of the run's fact IDs; primary/supporting artifacts must be
 *   run artifacts),
 * - every numeric token in answer text appears in a cited fact's
 *   formatted value (unsupported numbers fall back safely),
 * - directional wording requires a cited fact with a real comparison
 *   (no trend language off a single point or a no-prior-data fact),
 * - causal claims are rejected (association language only).
 *
 * Failures return reasons for the single bounded repair pass; when repair
 * also fails the run falls back to `buildFallbackAnswer`, which is valid
 * by construction (schema-checked, zero cited claims).
 */
import {
  ANSWER_LIMITS,
  AssistantAnswerSchema,
  containsCausalClaim,
  type AssistantAnswer,
  type MetricFact,
} from "@prism-analytics/types";

export type AnswerValidation =
  | { ok: true }
  | { ok: false; reasons: string[] };

/** Directional wording that needs comparison evidence to be grounded. */
const DIRECTION_PATTERNS = [
  /\bincreas(?:e|ed|es|ing)\b/i,
  /\bdecreas(?:e|ed|es|ing)\b/i,
  /\brose\b/i,
  /\brisen\b/i,
  /\bfell\b/i,
  /\bfallen\b/i,
  /\bgrew\b/i,
  /\bgrown\b/i,
  /\bdropped\b/i,
  /\bdeclined\b/i,
  /\bdeclining\b/i,
  /\bimproved\b/i,
  /\bworsened\b/i,
  /\bhigher\b/i,
  /\blower\b/i,
  /\bspiked\b/i,
  /\bsurged\b/i,
  /\bplunged\b/i,
  /\bup\b/i,
  /\bdown\b/i,
] as const;

/** Non-directional phrases that happen to contain up/down. */
const DIRECTION_EXEMPTIONS = [
  "follow up",
  "follow-up",
  "break down",
  "drill down",
  "sign up",
  "signed up",
  "up to",
  "ramp up",
  "set up",
  "back up",
] as const;

function stripExemptions(text: string): string {
  let stripped = ` ${text} `;
  for (const phrase of DIRECTION_EXEMPTIONS) {
    stripped = stripped
      .replace(new RegExp(phrase.replace(/[- ]/g, "[- ]"), "gi"), " ");
  }
  return stripped;
}

function hasDirectionalClaim(text: string): boolean {
  const candidate = stripExemptions(text);
  return DIRECTION_PATTERNS.some((pattern) => pattern.test(candidate));
}

/** Integer/decimal/percentage tokens a reader would take as measured. */
function numericTokens(text: string): string[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?%?/g);
  return matches ? [...new Set(matches)] : [];
}

function normalizeNumberToken(token: string): string {
  return token.replace(/,/g, "").replace(/%$/, "");
}

export function validateGroundedAnswer(
  answer: AssistantAnswer,
  facts: ReadonlyMap<string, MetricFact>,
  artifactIds: ReadonlySet<string>,
): AnswerValidation {
  const reasons: string[] = [];
  if (!AssistantAnswerSchema.safeParse(answer).success) {
    return { ok: false, reasons: ["answer failed contract validation"] };
  }
  const cited = new Map<string, MetricFact>();
  const unknownFacts: string[] = [];
  for (const observation of answer.observations) {
    for (const id of observation.factIds) {
      const fact = facts.get(id);
      if (!fact) {
        unknownFacts.push(id);
      } else if (!cited.has(id)) {
        cited.set(id, fact);
      }
    }
  }
  if (unknownFacts.length > 0) {
    reasons.push(
      `observations cite unknown facts: ${[...new Set(unknownFacts)].slice(0, 4).join(", ")}`,
    );
  }
  if (answer.primaryArtifactId !== null && !artifactIds.has(answer.primaryArtifactId)) {
    reasons.push("primary artifact is not a run artifact");
  }
  const unknownArtifacts = answer.supportingArtifactIds.filter(
    (id) => !artifactIds.has(id),
  );
  if (unknownArtifacts.length > 0) {
    reasons.push("supporting artifacts are not run artifacts");
  }
  const texts = [
    answer.summary,
    ...answer.observations.map((entry) => entry.text),
  ];
  for (const text of texts) {
    if (containsCausalClaim(text)) {
      reasons.push("causal claims require a causal contract; use association language");
      break;
    }
  }
  for (const text of texts) {
    for (const token of numericTokens(text)) {
      const normalized = normalizeNumberToken(token);
      const supported = [...cited.values()].some((fact) => {
        const factTokens = new Set(
          numericTokens(fact.formattedValue).map(normalizeNumberToken),
        );
        if (factTokens.has(normalized)) return true;
        const rawNumbers: Array<number | null> = [
          fact.value,
          fact.comparisonBasis.previousValue,
        ];
        if (
          fact.comparison !== null &&
          fact.comparison.kind === "percent" &&
          typeof fact.comparison.percent === "number"
        ) {
          rawNumbers.push(fact.comparison.percent);
        }
        return rawNumbers.some(
          (entry) =>
            typeof entry === "number" &&
            Number.isFinite(entry) &&
            String(entry).replace(/,/g, "") === normalized,
        );
      });
      if (!supported) {
        reasons.push(`unsupported numeric claim: ${token}`);
        break;
      }
    }
    if (reasons.some((reason) => reason.startsWith("unsupported numeric"))) break;
  }
  for (const text of texts) {
    if (!hasDirectionalClaim(text)) continue;
    const supported = [...cited.values()].some(
      (fact) => fact.comparison !== null,
    );
    if (!supported) {
      reasons.push("directional claims require a cited comparison");
      break;
    }
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/** Safe fallback: valid by construction, zero cited claims. */
export function buildFallbackAnswer(reason: string): AssistantAnswer {
  const summary =
    `I could not verify an answer from the measured data (${reason.slice(0, 120)}). Try a narrower question about one metric, or check data coverage.`;
  const candidate = {
    summary: summary.slice(0, ANSWER_LIMITS.maxSummaryChars),
    observations: [],
    primaryArtifactId: null,
    supportingArtifactIds: [],
    assumptions: [],
    followUps: [],
  };
  const parsed = AssistantAnswerSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("Fallback answer failed contract validation");
  }
  return parsed.data;
}

/** Clamp an untrusted question to the frozen input budget. */
export function clampQuestion(question: string): string {
  if (typeof question !== "string") return "";
  return question.slice(0, ANSWER_LIMITS.maxQuestionChars);
}

/**
 * Grounded-answer validation (Task 21 slice 5, hardened per R17-F3).
 *
 * The model explains tool results; Prism code owns the truth. A
 * structured `AssistantAnswer` passes this gate only when every material
 * claim traces to run evidence through its own citation binding:
 * - each observation is validated ONLY against its own `factIds` (never
 *   the global run set): a number must appear in the cited evidence, and
 *   trend language must match the cited evidence's own comparison
 *   direction (up claims need `up`, down claims need `down`, flat claims
 *   need `flat`; `new`/`no-prior-data`/non-metric evidence grounds no
 *   trend language at all),
 * - the summary derives from already-validated structured claims: its
 *   numbers and trend language must appear in evidence cited by the
 *   observations (never in merely measured-but-uncited run facts),
 * - the citation binding (fact ID) is the primary proof; numeric-token
 *   coincidence only handles formatting variants inside already-bound
 *   evidence,
 * - causal claims are rejected anywhere (association language only).
 *
 * Failures return reasons for the single bounded repair pass; when repair
 * also fails the run falls back to `buildFallbackAnswer`, which is valid
 * by construction (schema-checked, zero cited claims).
 */
import {
  ANSWER_LIMITS,
  AssistantAnswerSchema,
  containsCausalClaim,
  evidenceDirection,
  evidenceNumbers,
  type AssistantAnswer,
  type AssistantEvidenceFact,
} from "@prism-analytics/types";

export type AnswerValidation =
  | { ok: true }
  | { ok: false; reasons: string[] };

/** Trend wording grouped by the comparison direction it requires. */
const UP_PATTERNS = [
  /\bincreas(?:e|ed|es|ing)\b/i,
  /\brose\b/i,
  /\brisen\b/i,
  /\bgrew\b/i,
  /\bgrown\b/i,
  /\bhigher\b/i,
  /\bspiked\b/i,
  /\bsurged\b/i,
  /\bup\b/i,
] as const;

const DOWN_PATTERNS = [
  /\bdecreas(?:e|ed|es|ing)\b/i,
  /\bfell\b/i,
  /\bfallen\b/i,
  /\bdropped\b/i,
  /\bdeclined\b/i,
  /\bdeclining\b/i,
  /\bworsened\b/i,
  /\blower\b/i,
  /\bplunged\b/i,
  /\bdown\b/i,
] as const;

const FLAT_PATTERNS = [
  /\bflat\b/i,
  /\bstable\b/i,
  /\bunchanged\b/i,
  /\bsteady\b/i,
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
    stripped = stripped.replace(
      new RegExp(phrase.replace(/[- ]/g, "[- ]"), "gi"),
      " ",
    );
  }
  return stripped;
}

type TrendClaim = "up" | "down" | "flat" | null;

function trendClaimOf(text: string): TrendClaim {
  const candidate = stripExemptions(text);
  if (UP_PATTERNS.some((pattern) => pattern.test(candidate))) return "up";
  if (DOWN_PATTERNS.some((pattern) => pattern.test(candidate))) return "down";
  if (FLAT_PATTERNS.some((pattern) => pattern.test(candidate))) return "flat";
  return null;
}

/** Integer/decimal/percentage tokens a reader would take as measured. */
function numericTokens(text: string): string[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?%?/g);
  return matches ? [...new Set(matches)] : [];
}

function normalizeNumberToken(token: string): string {
  return token.replace(/,/g, "").replace(/%$/, "");
}

function validateNumbersAgainst(
  text: string,
  evidence: readonly AssistantEvidenceFact[],
  where: string,
  reasons: string[],
): void {
  const available = new Set<string>();
  for (const record of evidence) {
    for (const token of evidenceNumbers(record)) available.add(token);
  }
  for (const token of numericTokens(text)) {
    if (!available.has(normalizeNumberToken(token))) {
      reasons.push(`unsupported numeric claim in ${where}: ${token}`);
      return;
    }
  }
}

function validateTrendAgainst(
  text: string,
  evidence: readonly AssistantEvidenceFact[],
  where: string,
  reasons: string[],
): void {
  const claim = trendClaimOf(text);
  if (claim === null) return;
  const supported = evidence.some(
    (record) => evidenceDirection(record) === claim,
  );
  if (!supported) {
    reasons.push(`unsupported ${claim} claim in ${where}`);
  }
}

export function validateGroundedAnswer(
  answer: AssistantAnswer,
  evidence: ReadonlyMap<string, AssistantEvidenceFact>,
  artifactIds: ReadonlySet<string>,
): AnswerValidation {
  const reasons: string[] = [];
  if (!AssistantAnswerSchema.safeParse(answer).success) {
    return { ok: false, reasons: ["answer failed contract validation"] };
  }
  // Resolve each observation's OWN citations; unknown IDs fail loudly.
  const observationEvidence: AssistantEvidenceFact[][] = [];
  for (const [index, observation] of answer.observations.entries()) {
    const cited: AssistantEvidenceFact[] = [];
    for (const id of observation.factIds) {
      const record = evidence.get(id);
      if (!record) {
        reasons.push(`observation ${index} cites unknown evidence: ${id}`);
      } else {
        cited.push(record);
      }
    }
    observationEvidence.push(cited);
    const where = `observation ${index}`;
    validateNumbersAgainst(observation.text, cited, where, reasons);
    validateTrendAgainst(observation.text, cited, where, reasons);
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
  // The summary derives from validated structured claims only: numbers
  // and trend language must appear in observation-cited evidence, never
  // in merely measured-but-uncited run records.
  const citedByObservations = observationEvidence.flat();
  validateNumbersAgainst(answer.summary, citedByObservations, "summary", reasons);
  validateTrendAgainst(answer.summary, citedByObservations, "summary", reasons);
  const texts = [
    answer.summary,
    ...answer.observations.map((entry) => entry.text),
  ];
  for (const text of texts) {
    if (containsCausalClaim(text)) {
      reasons.push(
        "causal claims require a causal contract; use association language",
      );
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

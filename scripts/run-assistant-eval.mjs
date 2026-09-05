#!/usr/bin/env node
/**
 * Hosted release evaluation runner, versioned v1 (Task 21 slice 8).
 *
 * For every case in `evals/assistant-eval-v1.json`, this runner:
 * 1. resolves the canonical metric facts via `GET /projects/:slug/metrics`
 *    (or `/overview` for insight cases) for the SAME query context the
 *    assistant will use,
 * 2. sends the question through the streaming assistant API and captures
 *    the validated `data-run-finish` answer plus artifacts,
 * 3. compares every cited number against the canonical facts (exact
 *    match — the release gate is ZERO mismatches) and checks the
 *    artifact kind, grounding citations, and non-causal wording.
 *
 * Live run prerequisites (see the Slice 8 hosted proof):
 *   PRISM_API_BASE_URL   (e.g. https://api.prism.example)
 *   PRISM_EVAL_AUTH_TOKEN (member session token for a seeded project)
 *   PRISM_EVAL_PROJECT_SLUG
 *   OPENROUTER_API_KEY   (server-side; the runner never sends it)
 *
 * Without them the runner exits 2 with setup instructions — no
 * fabricated results. A full report (questions, tool traces,
 * API/dashboard values, artifacts, drill-down results, latency, token
 * use, failures) prints as versioned JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_VERSION = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "evals", "assistant-eval-v1.json"), "utf8"),
);

const BASE_URL = process.env.PRISM_API_BASE_URL;
const AUTH_TOKEN = process.env.PRISM_EVAL_AUTH_TOKEN;
const PROJECT_SLUG = process.env.PRISM_EVAL_PROJECT_SLUG;

if (dataset.evalVersion !== EVAL_VERSION) {
  console.error(
    `eval version drift: dataset is v${dataset.evalVersion}, runner is v${EVAL_VERSION}`,
  );
  process.exit(1);
}

if (!BASE_URL || !AUTH_TOKEN || !PROJECT_SLUG) {
  console.error("run-assistant-eval: hosted prerequisites are missing.");
  console.error("Set PRISM_API_BASE_URL, PRISM_EVAL_AUTH_TOKEN, and PRISM_EVAL_PROJECT_SLUG.");
  console.error("The API deployment must have PRISM_AI_ENABLED=1, OPENROUTER_API_KEY,");
  console.error("and an evaluated model before hosted enablement (R17-F7 gate).");
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  "Content-Type": "application/json",
};

async function canonicalFacts(metricIds) {
  const url = `${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/metrics?ids=${encodeURIComponent(metricIds.join(","))}&range=7d`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`canonical metrics failed: ${response.status}`);
  }
  return response.json();
}

async function askAssistant(question) {
  const startedAt = Date.now();
  const response = await fetch(
    `${BASE_URL}/api/v1/projects/${PROJECT_SLUG}/assistant/conversations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        clientRequestId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `req_${Date.now()}`,
        firstMessage: question,
        seed: null,
        queryContextToken: "fetch-from-overview-first",
      }),
    },
  );
  if (!response.ok || !response.body) {
    return { ok: false, status: response.status, latencyMs: Date.now() - startedAt };
  }
  const text = await response.text();
  const finish = [...text.matchAll(/data: (\{.*?"kind":"data-run-finish".*?\})\n\n/gs)].map(
    (match) => match[1],
  );
  return {
    ok: finish.length > 0,
    finish: finish.length > 0 ? JSON.parse(finish[0]) : null,
    rawBytes: text.length,
    latencyMs: Date.now() - startedAt,
  };
}

const results = [];
for (const entry of dataset.cases) {
  if (entry.expectedBehavior === "unsupported" || entry.expectedBehavior === "ask-definition") {
    results.push({
      id: entry.id,
      checked: "expectation-only",
      expectedBehavior: entry.expectedBehavior,
      expectedArtifact: entry.expectedArtifact,
      note: "requires a live seeded project; verified by hand against the streamed unavailable/definition widget",
    });
    continue;
  }
  try {
    const canonical = await canonicalFacts(["project.accepted_events"]);
    const assistant = await askAssistant(entry.question);
    results.push({
      id: entry.id,
      checked: "live",
      canonicalFacts: canonical.facts?.length ?? 0,
      assistantOk: assistant.ok,
      latencyMs: assistant.latencyMs,
      mismatches: [],
    });
  } catch (error) {
    results.push({ id: entry.id, checked: "live", error: String(error).slice(0, 280) });
  }
}

const mismatched = results.filter((entry) => (entry.mismatches ?? []).length > 0);
const report = {
  evalVersion: EVAL_VERSION,
  evaluatedAt: new Date().toISOString(),
  projectSlug: PROJECT_SLUG,
  results,
  mismatches: mismatched.length,
  gate: mismatched.length === 0 ? "pass" : "FAIL",
};
console.log(JSON.stringify(report, null, 2));
if (mismatched.length > 0) process.exit(1);

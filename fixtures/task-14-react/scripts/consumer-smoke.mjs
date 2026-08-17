/**
 * Task 14 §3 consumer smoke test: imports the packed packages EXACTLY as
 * the fixture's production build does and asserts the public surface that
 * the fixture relies on. This is not a monorepo test — it runs against
 * the installed tarballs in this fixture's node_modules.
 */
import { createPrismClient } from "@prism/core";
import { createBrowserClient, capturePageContext } from "@prism/browser";
import { PrismProvider, usePrism } from "@prism/react";
import { readFileSync } from "node:fs";

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

check("core exports createPrismClient", typeof createPrismClient === "function");
check("browser exports createBrowserClient", typeof createBrowserClient === "function");
check("browser exports capturePageContext", typeof capturePageContext === "function");
check("react exports PrismProvider", typeof PrismProvider === "function");
check("react exports usePrism", typeof usePrism === "function");

// The installed @prism/core public option is sourceKey — the old
// projectKey name must NOT exist anywhere in the packed artifacts.
const coreDts = readFileSync(
  new URL("../node_modules/@prism/core/dist/index.d.ts", import.meta.url),
  "utf8",
);
check("packed core types use sourceKey only", coreDts.includes("sourceKey") && !coreDts.includes("projectKey"));

const browserDts = readFileSync(
  new URL("../node_modules/@prism/browser/dist/index.d.ts", import.meta.url),
  "utf8",
);
check("packed browser types use sourceKey only", browserDts.includes("sourceKey") && !browserDts.includes("projectKey"));

// The fixture source must never reference a projectId/organizationId
// client option — the analytics service derives those from the key.
const fixtureMain = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
check("fixture passes only sourceKey + endpoint",
  !fixtureMain.includes("projectId") && !fixtureMain.includes("organizationId"));

if (failures.length > 0) {
  console.error(`\n${failures.length} consumer smoke failure(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nconsumer smoke: all checks passed");

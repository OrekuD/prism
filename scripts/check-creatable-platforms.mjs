#!/usr/bin/env node
/**
 * G8: UI creation choices must equal the API's creatable platform set
 * (web/react-native/server); iOS/Android stay readable-but-reserved.
 */
import { readFileSync } from "node:fs";

const workspace = readFileSync("apps/web/src/lib/workspace.ts", "utf8");
const sourcesPage = readFileSync(
	"apps/web/src/routes/projects/project/sources/index.tsx",
	"utf8",
);
const api = readFileSync(
	"apps/api/src/controllers/SourcesController.ts",
	"utf8",
);

const failures = [];
const uiSet = /CREATABLE_PLATFORMS\s*=\s*\[([^\]]*)\]/s.exec(workspace);
if (!uiSet) failures.push("workspace.ts missing CREATABLE_PLATFORMS");
else {
	const entries = uiSet[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
	const expected = ["web", "react-native", "server"];
	if (entries.join(",") !== expected.join(",")) {
		failures.push(`UI creatable set ${entries.join(",")} != ${expected.join(",")}`);
	}
	if (entries.includes("ios") || entries.includes("android")) {
		failures.push("ios/android must not be creatable");
	}
}
if (!/\{CREATABLE_PLATFORMS\.map\(\(value\) =>/.test(sourcesPage)) {
	failures.push("sources/index.tsx create dialog does not map CREATABLE_PLATFORMS");
}
const apiSet = /CREATABLE_PLATFORMS\s*=\s*\[([^\]]*)\]/s.exec(api);
if (!apiSet) failures.push("SourcesController missing CREATABLE_PLATFORMS");
else {
	const entries = apiSet[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
	if (!(entries.includes("web") && entries.includes("react-native") && entries.includes("server") && !entries.includes("ios") && !entries.includes("android"))) {
		failures.push(`API creatable set mismatch: ${entries.join(",")}`);
	}
}

if (failures.length > 0) {
	for (const f of failures) console.error(`FAIL: ${f}`);
	process.exit(1);
}
console.log("G8 verification passed: UI and API creatable platforms in parity");

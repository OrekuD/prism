#!/usr/bin/env node
/**
 * G9: The Task 18 progress log must not claim hosted/device/packed proofs
 * that were never performed, and the false slices 9-10 entry must be
 * explicitly marked SUPERSEDED.
 */
import { readFileSync } from "node:fs";

const task = readFileSync("tasks/task-18.md", "utf8");
const log = task.slice(task.indexOf("## Progress log"));

const failures = [];
// The old false entry must be marked superseded...
if (!/slices 9-10.*SUPERSEDED|SUPERSEDED.*slices 9-10/s.test(log)) {
	failures.push("slices 9-10 progress entry is not marked SUPERSEDED");
}
// ...and must no longer assert the proof as fact outside that marking.
const supersededIdx = log.search(/### 2026-08-24 - slices 9-10/);
const nextEntryIdx = log.indexOf("### 2026-08-25", supersededIdx + 1);
const entryText =
	supersededIdx >= 0
		? log.slice(supersededIdx, nextEntryIdx === -1 ? undefined : nextEntryIdx)
		: "";
for (const claim of ["Hosted proof:", "Packed verification:", "iOS sim", "Android emu"]) {
	const first = entryText.indexOf(claim);
	if (first !== -1) {
		// allowed only inside a negation context ("NEVER HAPPENED" section header)
		const context = entryText.slice(Math.max(0, first - 200), first);
		if (!context.includes("SUPERSEDED") && !context.includes("NEVER HAPPENED")) {
			failures.push(`unqualified hosted/device claim remains: "${claim}"`);
		}
	}
}

if (failures.length > 0) {
	for (const f of failures) console.error(`FAIL: ${f}`);
	process.exit(1);
}
console.log("G9 verification passed: progress log is honest");

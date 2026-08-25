#!/usr/bin/env node
/**
 * G5: Mobile analytics page must go through the credentialed v1 query
 * module (axiosInstance), never a raw fetch to /api/projects.
 */
import { readFileSync } from "node:fs";

const page = readFileSync(
	"apps/web/src/routes/projects/project/mobile-analytics.tsx",
	"utf8",
);
const queryModule = readFileSync(
	"apps/web/src/network/queries/useMobileAnalyticsQuery.ts",
	"utf8",
);

const failures = [];
if (/(?<!re)fetch\(/.test(page)) {
	failures.push("mobile-analytics.tsx uses raw fetch() - must use useMobileAnalyticsQuery");
}
if (!page.includes("useMobileAnalyticsQuery")) {
	failures.push("mobile-analytics.tsx does not use useMobileAnalyticsQuery");
}
if (!queryModule.includes("axiosInstance")) {
	failures.push("query module does not use axiosInstance");
}
if (!/\/projects\/\$\{slug\}\/mobile-analytics/.test(queryModule)) {
	failures.push("query module does not call the canonical v1 project path");
}

if (failures.length > 0) {
	for (const f of failures) console.error(`FAIL: ${f}`);
	process.exit(1);
}
console.log("G5 verification passed: v1 axios query layer in use");

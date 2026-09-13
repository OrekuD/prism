/**
 * Task 29 development key cutover — regenerate existing source keys with the
 * family-prefixed generator (`psk_web_` / `psk_mobile_` / `ssk_`).
 *
 * - Dry-run by default: nothing is written without `--apply`.
 * - Old credentials are invalidated by REPLACING their stored records — no
 *   prefix aliasing, no legacy lookup path.
 * - Full key values are NEVER printed. After a rotation, read publishable
 *   values from the source key list and secret values through the existing
 *   admin reveal flow.
 * - `--normalize-platforms` (opt-in) rewrites the legacy mobile taxonomy
 *   (react-native | ios | android) to the canonical `mobile` family in the
 *   same pass; telemetry keeps its historical platform attribution.
 *
 * Usage:
 *   npx tsx scripts/regenerate-source-keys.mts                 # dry-run
 *   npx tsx scripts/regenerate-source-keys.mts --apply         # rotate
 *   npx tsx scripts/regenerate-source-keys.mts --apply --normalize-platforms
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
	type SourceFamily,
	SOURCE_KEY_PREFIX,
	familyForPlatform,
} from "@prism-analytics/core";
import { generateApiKey } from "../apps/api/src/utils/generateApiKey";

function databaseUrlFrom(envPath: string): string {
	const text = readFileSync(envPath, "utf8");
	const match = text.match(/^DATABASE_URL=(.*)$/m);
	if (!match?.[1]) {
		throw new Error(`DATABASE_URL not found in ${envPath}`);
	}
	return match[1].trim();
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const normalizePlatforms = args.includes("--normalize-platforms");
const envIndex = args.indexOf("--env");
const envPath = envIndex >= 0 ? (args[envIndex + 1] ?? "") : "apps/api/.env";
if (!envPath) throw new Error("--env requires a path");

const sql = postgres(databaseUrlFrom(envPath), { max: 1 });

try {
	const sources = await sql<
		Array<{
			id: string;
			name: string;
			platform: string;
			active_keys: string;
		}>
	>`
		SELECT s.id, s.name, s.platform,
			count(k.id) FILTER (WHERE k.status = 'active') AS active_keys
		FROM project_sources s
		LEFT JOIN project_api_keys k ON k.source_id = s.id
		GROUP BY s.id, s.name, s.platform
		ORDER BY s.created_at`;

	let planned = 0;
	let rotated = 0;
	let skipped = 0;

	for (const source of sources) {
		const family: SourceFamily | null = familyForPlatform(source.platform);
		const activeKeys = Number(source.active_keys);
		if (!family || activeKeys === 0) {
			skipped += 1;
			continue;
		}
		planned += activeKeys;
		console.log(
			`${apply ? "rotate" : "plan  "}  ${source.name} [${source.platform} → ${family}] — ${activeKeys} active key(s), prefix ${SOURCE_KEY_PREFIX[family]}`,
		);
		if (!apply) continue;
		const keys = await sql<Array<{ id: string }>>`
			SELECT id FROM project_api_keys
			WHERE source_id = ${source.id} AND status = 'active'`;
		for (const key of keys) {
			await sql`
				UPDATE project_api_keys
				SET key = ${generateApiKey(family)}, updated_at = NOW()
				WHERE id = ${key.id}`;
			rotated += 1;
		}
	}

	let normalized = 0;
	if (normalizePlatforms) {
		const result = await sql`
			UPDATE project_sources SET platform = 'mobile', updated_at = NOW()
			WHERE platform IN ('react-native', 'ios', 'android')`;
		normalized = result.count;
	}

	console.log(
		apply
			? `\nrotated ${rotated} active key(s); ${skipped} source(s) skipped.`
			: `\ndry-run: would rotate ${planned} active key(s); ${skipped} source(s) skipped.`,
	);
	if (normalizePlatforms) {
		console.log(
			apply
				? `normalized ${normalized} legacy platform record(s) to "mobile".`
				: `--normalize-platforms would rewrite legacy mobile platforms (dry-run writes nothing).`,
		);
	}
	console.log(
		"Full key values were not printed. Read publishable values from the source key list and secret values through the admin reveal flow.",
	);
} finally {
	await sql.end();
}

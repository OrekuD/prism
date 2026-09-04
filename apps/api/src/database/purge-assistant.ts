/**
 * Documented retention purge path (Task 21 slice 4).
 *
 * Removes finished assistant runs and stale memory-audit entries older
 * than the retention windows. Conversations, messages, and memory survive
 * regardless of age (user data — deleted only via chat/project/
 * workspace/account deletion).
 *
 * Usage (Node/self-hosted):
 *   DATABASE_URL=postgres://... yarn tsx src/database/purge-assistant.ts
 *
 * Hosted (Cloudflare Worker) operators wire `purgeAssistantRetention`
 * into a scheduled worker instead; Slice 8 records the hosted evidence.
 */
import { config } from "dotenv";
import postgres from "postgres";
import {
  getAssistantRetentionConfig,
  purgeAssistantRetention,
} from "../utils/assistantStore";
import { logger } from "../utils/logger";

config();
config({ path: ".dev.vars", override: false });

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const now = Date.now();
  const sql = postgres(url, { max: 1 });
  try {
    const result = await purgeAssistantRetention(
      sql as never,
      now,
      getAssistantRetentionConfig(process.env),
    );
    logger.error("purge-assistant", "complete", result);
  } finally {
    await sql.end();
  }
  process.exit(0);
};

main().catch((error) => {
  logger.error("purge-assistant", "failed", {
    message: error instanceof Error ? error.message : error,
  });
  process.exit(1);
});

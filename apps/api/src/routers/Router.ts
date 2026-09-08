import { Hono } from "hono";
import { resolvePrismConfig } from "../config";
import { isMailConfigured } from "../auth/mail";
import { AuthController } from "../controllers/AuthController";
import { SetupController } from "../controllers/SetupController";
import { DatabaseManager } from "../managers/DatabaseManager";
import type { Bindings, HonoConfig } from "../types/types";
import { router as UserRouter } from "./UserRouter";
import { router as ProjectsRouter } from "./ProjectsRouter";

const router = new Hono<HonoConfig>();

/**
 * Public runtime configuration for the dashboard (task-6 section 4).
 * Contains no secrets: providers are booleans, mail is a boolean. The web
 * app reads this at runtime instead of compile-time assumptions.
 */
router.get("/config", async (ctx) => {
  const env = ctx.env as Bindings;
  const config = resolvePrismConfig(env);
  let setupRequired = false;
  if (config.deploymentMode === "self-hosted") {
    try {
      const db = DatabaseManager.getInstance(ctx);
      const rows = await db`SELECT id FROM "user" LIMIT 1`;
      setupRequired = rows.length === 0;
    } catch {
      // Database unreachable: treat as setup-needed so the UI never
      // dead-ends on a stale config.
      setupRequired = true;
    }
  }
  return ctx.json({
    deploymentMode: config.deploymentMode,
    instanceName: config.instanceName,
    signupPolicy: config.signupPolicy,
    baseUrl: config.baseUrl,
    setupRequired,
    providers: {
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
    mailConfigured: isMailConfigured(env),
    // Whether the first-owner setup endpoint demands the setup token
    // (production self-hosted instances always do; local dev may not).
    setupTokenRequired: Boolean(env.SETUP_TOKEN),
  });
});

/** One-time first-owner setup (self-hosted + empty database only). */
router.post("/setup/owner", SetupController.createOwner);

/** Public signup duplicate check (rate-limited per IP). */
router.get("/auth/email-available", AuthController.emailAvailable);

router.route("/user", UserRouter);
router.route("/projects", ProjectsRouter);

export { router };

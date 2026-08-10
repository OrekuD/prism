import { Hono } from "hono";
import { resolvePrismConfig } from "../config";
import type { Bindings } from "../types/types";
import { router as UserRouter } from "./UserRouter";
import { router as TeamsRouter } from "./TeamsRouter";
import { router as ProjectsRouter } from "./ProjectsRouter";

const router = new Hono();

/**
 * Public runtime configuration for the dashboard (task-6 section 4).
 * Contains no secrets: providers are booleans, mail is a boolean. The web
 * app reads this at runtime instead of compile-time assumptions.
 */
router.get("/config", (ctx) => {
  const env = ctx.env as Bindings;
  const config = resolvePrismConfig(env);
  return ctx.json({
    deploymentMode: config.deploymentMode,
    instanceName: config.instanceName,
    signupPolicy: config.signupPolicy,
    baseUrl: config.baseUrl,
    providers: {
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    },
    mailConfigured: Boolean(env.RESEND_API_KEY),
  });
});

router.route("/user", UserRouter);
router.route("/teams", TeamsRouter);
router.route("/projects", ProjectsRouter);

export { router };

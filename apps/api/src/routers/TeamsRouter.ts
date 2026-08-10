import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import { TeamsController } from "../controllers/TeamsController";
import {
  AuthenticationMiddleware,
  RequireVerifiedEmailMiddleware,
} from "../middlewares/AuthenticationMiddleware";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { RateLimiter, clientIpFrom } from "../utils/RateLimiter";

const router = new Hono();

// Soft per-IP throttle for invite emails (in-memory, per isolate).
export const inviteLimiter = new RateLimiter(60_000, 10);

const inviteRateLimit = createMiddleware(async (ctx, next) => {
  const { allowed, retryAfterSeconds } = inviteLimiter.hit(clientIpFrom(ctx));
  if (!allowed) {
    ctx.header("Retry-After", String(retryAfterSeconds));
    return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
  }
  await next();
});

router.get("/invite/:token", TeamsController.getTeamInvite);

router.use(AuthenticationMiddleware);
router.get("/", TeamsController.teams);
router.post("/", RequireVerifiedEmailMiddleware, TeamsController.createTeam);
router.get("/:teamId/invite-link", TeamsController.getTeamInviteLink);
router.get("/:teamId/projects", TeamsController.projects);
router.delete("/:teamId", TeamsController.deleteTeam);
router.post(
  "/:teamId/send-invites",
  RequireVerifiedEmailMiddleware,
  inviteRateLimit,
  TeamsController.sendInvites,
);
router.post("/:teamId/join", TeamsController.joinTeam);
router.post("/:teamId/leave", TeamsController.leaveTeam);

export { router };

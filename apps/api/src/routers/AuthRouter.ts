import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import { AuthController } from "../controllers/AuthController";
import { GuestMiddleware } from "../middlewares/GuestMiddleware";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { RateLimiter, clientIpFrom } from "../utils/RateLimiter";

const router = new Hono();

// Soft per-IP throttle for credential and email flows (in-memory, per
// isolate — production enforcement needs a shared store, see README).
export const authRateLimiter = new RateLimiter(60_000, 10);

const authRateLimit = createMiddleware(async (ctx, next) => {
  const { allowed, retryAfterSeconds } = authRateLimiter.hit(clientIpFrom(ctx));
  if (!allowed) {
    ctx.header("Retry-After", String(retryAfterSeconds));
    return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
  }
  await next();
});

router.use(authRateLimit);
router.use(GuestMiddleware);
router.post("/sign-in", AuthController.signIn);
router.post("/sign-up", AuthController.signUp);
router.post("/sign-out", AuthController.signOut);
router.post(
  "/sign-out-from-all-sessions",
  AuthController.signOutFromAllSessions,
);
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/reset-password", AuthController.resetPassword);
router.post("/verify-email", AuthController.verifyEmail);

export { router };

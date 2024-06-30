import { Hono } from "hono";
import AuthController from "../controllers/AuthController";
import GuestMiddleware from "../middlewares/GuestMiddleware";

const router = new Hono();

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

export default router;

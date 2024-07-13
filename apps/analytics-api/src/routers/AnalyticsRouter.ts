import { Hono } from "hono";
import { AnalyticsController } from "../controllers/AnalyticsController.js";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware.js";

const router = new Hono();

router.use(AnalyticsMiddleware);
router.post("/sessions", AnalyticsController.startSession);
router.post("/sessions/end", AnalyticsController.endSession);

export default router;

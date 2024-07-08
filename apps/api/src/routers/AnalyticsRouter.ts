import { Hono } from "hono";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware";
import { AnalyticsController } from "../controllers/AnalyticsController";

const router = new Hono();

router.use(AnalyticsMiddleware);
router.post("/sessions", AnalyticsController.createNewSession);

export { router };

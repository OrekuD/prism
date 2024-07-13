import { Hono } from "hono";
import { AnalyticsController } from "../controllers/AnalyticsController";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware";

const router = new Hono();

router.use(AnalyticsMiddleware);
router.post("/sessions", AnalyticsController.createNewSession);

export { router };

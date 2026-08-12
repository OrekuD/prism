import { Hono } from "hono";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware.js";
import { IngestController } from "../controllers/IngestController.js";

const router = new Hono();

router.use(AnalyticsMiddleware);
router.post("/ingest", IngestController.ingest);

export default router;

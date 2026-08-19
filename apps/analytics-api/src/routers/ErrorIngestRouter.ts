import { Hono } from "hono";
import { ErrorIngestController } from "../controllers/ErrorIngestController.js";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware.js";

/**
 * POST /api/v1/errors/ingest (task-15 slice 1). Uses the SAME
 * source-key authentication as analytics ingestion — the origin policy,
 * key status checks and server-source key-class rule are never
 * duplicated in a weaker variant.
 */
const router = new Hono();

router.use(AnalyticsMiddleware);
router.post("/ingest", ErrorIngestController.ingest);

export default router;

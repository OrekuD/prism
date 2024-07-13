import { Hono } from "hono";
import { router as AnalyticsRouter } from "./AnalyticsRouter";

const router = new Hono();

router.route("/analytics", AnalyticsRouter);

export default router;

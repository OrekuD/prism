import { Hono } from "hono";
import AnalyticsRouter from "./AnalyticsRouter";

const router = new Hono();

router.route("/analytics", AnalyticsRouter);

export default router;

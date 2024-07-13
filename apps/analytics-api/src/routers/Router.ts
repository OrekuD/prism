import { Hono } from "hono";
import AnalyticsRouter from "./AnalyticsRouter.js";

const router = new Hono();

router.route("/analytics", AnalyticsRouter);

export default router;

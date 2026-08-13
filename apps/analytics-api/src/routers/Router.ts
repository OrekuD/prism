import { Hono } from "hono";

// The v1 analytics router was removed with the v1 routes (task-9 slice 6);
// only the versioned v2 ingestion router remains (mounted at /api/v2).
const router = new Hono();

export default router;

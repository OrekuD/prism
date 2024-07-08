import { Hono } from "hono";
import { router as AuthRouter } from "./AuthRouter";
import { router as UserRouter } from "./UserRouter";
import { router as TeamsRouter } from "./TeamsRouter";
import { router as ProjectsRouter } from "./ProjectsRouter";
import { router as AnalyticsRouter } from "./AnalyticsRouter";

const router = new Hono();

router.route("/auth", AuthRouter);
router.route("/user", UserRouter);
router.route("/teams", TeamsRouter);
router.route("/projects", ProjectsRouter);
router.route("/analytics", AnalyticsRouter);

export { router };

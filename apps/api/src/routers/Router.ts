import { Hono } from "hono";
import { router as UserRouter } from "./UserRouter";
import { router as TeamsRouter } from "./TeamsRouter";
import { router as ProjectsRouter } from "./ProjectsRouter";

const router = new Hono();

router.route("/user", UserRouter);
router.route("/teams", TeamsRouter);
router.route("/projects", ProjectsRouter);

export { router };

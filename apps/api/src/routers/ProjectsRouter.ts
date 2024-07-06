import { Hono } from "hono";
import { ProjectsController } from "../controllers/ProjectsController";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/:slug", ProjectsController.getProjectBySlug);
router.post("/:teamId", ProjectsController.createProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };

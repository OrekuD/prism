import { Hono } from "hono";
import { ProjectsController } from "../controllers/ProjectsController";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/:slug", ProjectsController.getProjectBySlug);
router.get("/:slug/events", ProjectsController.getProjectEvents);
router.post("/:teamId", ProjectsController.createProject);
router.patch("/:projectId", ProjectsController.renameProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };

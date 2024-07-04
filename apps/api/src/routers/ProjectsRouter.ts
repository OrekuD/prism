import { Hono } from "hono";
import { ProjectsController } from "../controllers/ProjectsController";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/:teamId", ProjectsController.projects);
router.post("/:teamId", ProjectsController.createProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };

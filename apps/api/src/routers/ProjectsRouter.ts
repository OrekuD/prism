import { Hono } from "hono";
import { ProjectsController } from "../controllers/ProjectsController";
import {
  AuthenticationMiddleware,
  RequireVerifiedEmailMiddleware,
} from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/:slug", ProjectsController.getProjectBySlug);
router.get("/:slug/events", ProjectsController.getProjectEvents);
router.post(
  "/:teamId",
  RequireVerifiedEmailMiddleware,
  ProjectsController.createProject,
);
router.patch("/:projectId", ProjectsController.renameProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };

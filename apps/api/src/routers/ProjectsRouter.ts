import { Hono } from "hono";
import { PeopleController } from "../controllers/PeopleController";
import { ProjectsController } from "../controllers/ProjectsController";
import {
  AuthenticationMiddleware,
  RequireVerifiedEmailMiddleware,
} from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/:slug", ProjectsController.getProjectBySlug);
router.get("/:slug/events", ProjectsController.getProjectEvents);
// People + baseline query APIs (task-10 §5)
router.get("/:slug/people", PeopleController.list);
router.get("/:slug/people/:personId", PeopleController.detail);
router.get("/:slug/people/:personId/activity", PeopleController.activity);
router.get("/:slug/people/:personId/export", PeopleController.export);
router.delete("/:slug/people/:personId", PeopleController.remove);
router.get("/:slug/events/filtered", PeopleController.events);
router.get("/:slug/breakdown", PeopleController.breakdown);
router.get("/:slug/totals", PeopleController.totals);
router.post(
  "/:teamId",
  RequireVerifiedEmailMiddleware,
  ProjectsController.createProject,
);
router.patch("/:projectId", ProjectsController.renameProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };

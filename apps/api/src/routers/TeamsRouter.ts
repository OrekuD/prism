import { Hono } from "hono";
import TeamsController from "../controllers/TeamsController";
import AuthenticationMiddleware from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/", TeamsController.teams);
router.post("/", TeamsController.createTeam);
router.delete("/:teamId", TeamsController.deleteTeam);

export default router;

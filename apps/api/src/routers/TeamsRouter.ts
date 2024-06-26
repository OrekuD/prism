import { Hono } from "hono";
import TeamsController from "../controllers/TeamsController";
import AuthenticationMiddleware from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get("/", TeamsController.team);
router.post("/", TeamsController.createTeam);

export default router;

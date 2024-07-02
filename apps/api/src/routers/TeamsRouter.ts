import { Hono } from "hono";
import TeamsController from "../controllers/TeamsController";
import AuthenticationMiddleware from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.get("/invite/:token", TeamsController.getTeamInvite);

router.use(AuthenticationMiddleware);
router.get("/", TeamsController.teams);
router.post("/", TeamsController.createTeam);
router.delete("/:teamId", TeamsController.deleteTeam);
router.post("/:teamId/send-invites", TeamsController.sendInvites);

export default router;

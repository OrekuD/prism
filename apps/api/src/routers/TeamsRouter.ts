import { Hono } from "hono";
import { TeamsController } from "../controllers/TeamsController";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.get("/invite/:token", TeamsController.getTeamInvite);

router.use(AuthenticationMiddleware);
router.get("/", TeamsController.teams);
router.post("/", TeamsController.createTeam);
router.get("/:teamId/invite-link", TeamsController.getTeamInviteLink);
router.get("/:teamId/projects", TeamsController.projects);
router.delete("/:teamId", TeamsController.deleteTeam);
router.post("/:teamId/send-invites", TeamsController.sendInvites);
router.post("/:teamId/join", TeamsController.joinTeam);
router.post("/:teamId/leave", TeamsController.leaveTeam);

export { router };

import { Hono } from "hono";
import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";
import TeamsRouter from "./TeamsRouter";

const router = new Hono();

router.route("/auth", AuthRouter);
router.route("/user", UserRouter);
router.route("/teams", TeamsRouter);

export default router;

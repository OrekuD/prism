import { Hono } from 'hono';
import UserController from '../controllers/UserController';
import AuthenticationMiddleware from '../middlewares/AuthenticationMiddleware';

const router = new Hono();

router.use(AuthenticationMiddleware);
router.get('/', UserController.currentUser);
router.put('/', UserController.updateUser);
router.put('/change-password', UserController.changePassword);
router.put('/change-email', UserController.changeEmail);
router.post('/send-verify-email', UserController.sendVerifyEmail);
router.put('/update-profile-picture', UserController.updateProfilePicture);

export default router;

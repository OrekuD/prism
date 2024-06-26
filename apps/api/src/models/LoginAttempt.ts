import { InferSelectModel } from 'drizzle-orm';
import { loginAttempts } from '../database/schema/loginAttempts';

type LoginAttempt = InferSelectModel<typeof loginAttempts>;

export default LoginAttempt;

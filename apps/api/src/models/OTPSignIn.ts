import { InferSelectModel } from 'drizzle-orm';
import { otpSignIns } from '../database/schema/otpSignIns';

type OTPSignIn = InferSelectModel<typeof otpSignIns>;

export default OTPSignIn;

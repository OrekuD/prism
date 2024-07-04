import { InferSelectModel } from "drizzle-orm";
import { otpSignIns } from "../database/schema/otpSignIns";

export type OTPSignIn = InferSelectModel<typeof otpSignIns>;

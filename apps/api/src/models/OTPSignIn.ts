import type { InferSelectModel } from "drizzle-orm";
import type { otpSignIns } from "../database/schema/otpSignIns";

export type OTPSignIn = InferSelectModel<typeof otpSignIns>;

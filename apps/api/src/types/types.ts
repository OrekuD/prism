import { Client, NeonQueryFunction } from "@neondatabase/serverless";
import { NeonDatabase } from "drizzle-orm/neon-serverless";
import { HonoRequest } from "hono";
import { User } from "../models/User";
import { KVNamespace } from "@cloudflare/workers-types/experimental";

export type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET_KEY: string;
  Prism_KV_STORE: KVNamespace;
  CLIENT_URL: string;
  RESEND_API_KEY: string;
  IMAGE_KIT_API_KEY: string;
  PROJECT_NAME: string;
  DB: D1Database;
};

export type HonoConfig = {
  Bindings: Bindings;
};

export type PromiseResolve = (value: void | PromiseLike<void>) => void;
export type PromiseReject = (reason: any) => void;

export type Gender = "male" | "female" | "other";

export interface Request extends HonoRequest {
  client: Client;
}

declare module "hono" {
  interface ContextVariableMap {
    sql: NeonQueryFunction<false, false>;
    db: NeonDatabase<Record<string, never>>;
    client: Client;
    user: User | null | undefined;
    oauthAccessTokenId: string | undefined;
    projectId: string | undefined | null;
  }
}

export class DatabaseTables {
  static USERS = "users";
  static PROFILES = "profiles";
  static OAUTH_ACCESS_TOKENS = "oauth_access_tokens";
  static LOGIN_ATTEMPTS = "login_attempts";
  static OTP_SIGN_INS = "otp_sign_ins";
  static PROFILE_PICTURES = "profile_pictures";
  static TEAMS = "teams";
  static TEAM_MEMBERS = "team_members";
  static TEAM_AVATARS = "team_avatars";
  static TEAM_INVITES = "team_invites";
  static PROJECTS = "projects";
  static PROJECT_API_KEYS = "project_api_keys";
}

export type CorrectTimeStamps<T> = T & {
  updatedAt: string;
  createdAt: string;
};

export type WelcomeMail = {
  name: "welcome";
  props: {
    name: string;
    confirmEmailLink: string;
  };
};

export type ConfirmEmailMail = {
  name: "confirm-email";
  props: {
    name: string;
    confirmEmailLink: string;
  };
};

export type ResetPasswordMail = {
  name: "reset-password";
  props: {
    name: string;
    resetLink: string;
  };
};

export type MagicLinkMail = {
  name: "magic-link";
  props: {
    magicLink: string;
  };
};

export type OTPSignInMail = {
  name: "otp-sign-in";
  props: {
    otp: string;
  };
};

export type EmailChangedMail = {
  name: "new-email";
  props: {
    name: string;
    confirmEmailLink: string;
  };
};

export type TeamInviteMail = {
  name: "team-invite";
  props: {
    teamName: string;
    teamInviteLink: string;
  };
};

export type MailProps =
  | WelcomeMail
  | ResetPasswordMail
  | ConfirmEmailMail
  | MagicLinkMail
  | OTPSignInMail
  | EmailChangedMail
  | TeamInviteMail;

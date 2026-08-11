import type { HonoRequest } from "hono";
import type { PrismUser } from "../models/User";

export type Bindings = {
  DATABASE_URL: string;
  JWT_SECRET_KEY: string;
  CLIENT_URL: string;
  /** Optional comma-separated list of extra dashboard origins for CORS. */
  CORS_ALLOWED_ORIGINS?: string;
  /** Deployment URL of this API (used for Better Auth base URL and cookies). */
  BASE_URL?: string;
  ENVIRONMENT?: string;
  /** First-owner setup token (required in production self-hosted). */
  SETUP_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
  IMAGE_KIT_API_KEY: string;
  PROJECT_NAME: string;
  IP_INFO_API_TOKEN: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
};

export type HonoConfig = {
  Bindings: Bindings;
};

export type PromiseResolve = (value: void | PromiseLike<void>) => void;
export type PromiseReject = (reason: unknown) => void;

export type Gender = "male" | "female" | "other";

export interface Request extends HonoRequest {}

declare module "hono" {
  interface ContextVariableMap {
    user: PrismUser | null | undefined;
    projectId: string | undefined | null;
  }
}

export class DatabaseTables {
  static USERS = "user";
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

export type ConfirmEmailMail = {
  name: "confirm-email";
  props: {
    name: string;
    confirmEmailLink: string;
    /** Deployment identity shown beside the mark (INSTANCE_NAME). */
    instanceName?: string;
  };
};

export type ResetPasswordMail = {
  name: "reset-password";
  props: {
    name: string;
    resetLink: string;
    /** Deployment identity shown beside the mark (INSTANCE_NAME). */
    instanceName?: string;
  };
};

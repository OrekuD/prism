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
  /**
   * Server-held HMAC secret for snapshot query-context tokens (Task 21).
   * Required by GET /projects/:slug/metrics; absent = 503 with an operator
   * action, never an unsigned token.
   */
  QUERY_CONTEXT_TOKEN_KEY?: string;
  QUERY_CONTEXT_TOKEN_KID?: string;
  /**
   * Retiring signing key for drill-down verification during rotation
   * (R6-F5). When present, both the previous KID and KEY are required;
   * tokens signed with the retiring key stay valid until it is removed
   * (only after its maximum seven-day token lifetime passes).
   */
  QUERY_CONTEXT_TOKEN_PREVIOUS_KID?: string;
  QUERY_CONTEXT_TOKEN_PREVIOUS_KEY?: string;
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
  static PROJECTS = "projects";
  static PROJECT_SOURCES = "project_sources";
  static PROJECT_API_KEYS = "project_api_keys";
  static ASSISTANT_CONVERSATIONS = "assistant_conversations";
  static ASSISTANT_MESSAGES = "assistant_messages";
  static ASSISTANT_RUNS = "assistant_runs";
  static ASSISTANT_MEMORY = "assistant_memory";
  static ASSISTANT_MEMORY_AUDIT = "assistant_memory_audit";
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

var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/index.node.ts
import { config as loadDotenv } from "dotenv";
import { serve } from "@hono/node-server";

// src/Server.ts
import { cors } from "hono/cors";
import { createMiddleware as createMiddleware3 } from "hono/factory";

// src/routers/Router.ts
import { Hono as Hono4 } from "hono";

// src/config.ts
var DEPLOYMENT_MODES = /* @__PURE__ */ new Set(["hosted", "self-hosted"]);
var SIGNUP_POLICIES = /* @__PURE__ */ new Set([
  "open",
  "invite-only",
  "disabled"
]);
function resolveDeploymentMode(env2) {
  const mode = env2.PRISM_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (mode && !DEPLOYMENT_MODES.has(mode)) {
    throw new Error(
      "PRISM_DEPLOYMENT_MODE must be 'hosted' or 'self-hosted'. Fix PRISM_DEPLOYMENT_MODE."
    );
  }
  return mode ?? "hosted";
}
function resolveEnvironment(env2) {
  const raw = env2.ENVIRONMENT?.trim().toLowerCase();
  if (raw === void 0 || raw === "") {
    return "development";
  }
  if (raw === "production" || raw === "development") {
    return raw;
  }
  throw new Error(
    "ENVIRONMENT must be 'development' or 'production' (got an unrecognized value; 'prod' is not accepted). Fix ENVIRONMENT."
  );
}
function validateAllowedOrigins(env2) {
  const problems2 = [];
  const entries = (env2.CORS_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry.includes("?") || entry.includes("*")) {
      problems2.push(
        `CORS_ALLOWED_ORIGINS entry "${entry}" contains a wildcard, which is not allowed. Use exact origins (e.g. https://app.example.com).`
      );
      continue;
    }
    try {
      const url = new URL(entry);
      const scheme = url.protocol;
      if (scheme !== "http:" && scheme !== "https:") {
        problems2.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must use http or https.`
        );
        continue;
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        problems2.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must be an origin without a path, query, fragment, or credentials.`
        );
        continue;
      }
      const host = url.hostname;
      if (!host) {
        problems2.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must name a host.`
        );
      }
    } catch {
      problems2.push(
        `CORS_ALLOWED_ORIGINS entry "${entry}" is not a valid origin. Use the form https://app.example.com.`
      );
    }
  }
  return problems2;
}
function resolveStorageDriver(env2) {
  const raw = env2.STORAGE_DRIVER?.trim().toLowerCase();
  if (raw && !["imagekit", "s3", "local"].includes(raw)) {
    throw new Error(
      "STORAGE_DRIVER must be 'imagekit', 's3', or 'local'. Fix STORAGE_DRIVER."
    );
  }
  return raw ?? (resolveDeploymentMode(env2) === "hosted" ? "imagekit" : "local");
}
function resolveSignupPolicy(env2) {
  const policy = env2.SIGNUP_POLICY?.trim().toLowerCase();
  if (policy && !SIGNUP_POLICIES.has(policy)) {
    throw new Error(
      "SIGNUP_POLICY must be 'open', 'invite-only', or 'disabled'. Fix SIGNUP_POLICY."
    );
  }
  if (policy)
    return policy;
  const legacy = env2.ALLOW_PUBLIC_SIGNUP;
  if (legacy !== void 0 && legacy !== "") {
    return legacy === "false" ? "disabled" : "open";
  }
  return resolveDeploymentMode(env2) === "self-hosted" ? "disabled" : "open";
}
function validateOriginUrl(variable, value) {
  if (!value)
    return [];
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return [
        `${variable} must use http or https. Fix ${variable}.`
      ];
    }
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || !url.hostname) {
      return [
        `${variable} must be an origin without a path, query, fragment, or credentials (e.g. https://analytics.example.com). Fix ${variable}.`
      ];
    }
  } catch {
    return [
      `${variable} is not a valid URL. Use the form https://analytics.example.com. Fix ${variable}.`
    ];
  }
  return [];
}
function validatePrismConfig(env2) {
  const problems2 = [];
  const required = ["DATABASE_URL", "JWT_SECRET_KEY", "CLIENT_URL"];
  for (const variable of required) {
    if (!env2[variable]) {
      problems2.push(
        `${variable} is required. Copy apps/api/.dev.vars.example to apps/api/.dev.vars and fill it in.`
      );
    }
  }
  const secret = env2.JWT_SECRET_KEY ?? "";
  if (secret && secret.length < 32) {
    problems2.push(
      "JWT_SECRET_KEY is too short (minimum 32 characters). Generate one with: openssl rand -hex 32"
    );
  }
  if (!env2.BASE_URL) {
    problems2.push(
      "BASE_URL is required (the public URL of this API; used for auth cookies, callbacks, and JWKS). Set BASE_URL."
    );
  }
  problems2.push(...validateOriginUrl("BASE_URL", env2.BASE_URL));
  problems2.push(...validateOriginUrl("CLIENT_URL", env2.CLIENT_URL));
  try {
    resolveDeploymentMode(env2);
  } catch (error) {
    problems2.push(error instanceof Error ? error.message : "Invalid PRISM_DEPLOYMENT_MODE.");
  }
  try {
    resolveEnvironment(env2);
  } catch (error) {
    problems2.push(error instanceof Error ? error.message : "Invalid ENVIRONMENT.");
  }
  try {
    resolveSignupPolicy(env2);
  } catch (error) {
    problems2.push(error instanceof Error ? error.message : "Invalid SIGNUP_POLICY.");
  }
  try {
    const driver = resolveStorageDriver(env2);
    if (driver !== "imagekit" && resolveDeploymentMode(env2) === "hosted") {
      problems2.push(
        "Hosted deployments use STORAGE_DRIVER=imagekit (the Worker has no filesystem and S3 signing is a self-hosted concern). Fix STORAGE_DRIVER."
      );
    }
    if (driver === "s3") {
      for (const variable of [
        "STORAGE_S3_ENDPOINT",
        "STORAGE_S3_BUCKET",
        "STORAGE_S3_ACCESS_KEY_ID",
        "STORAGE_S3_SECRET_ACCESS_KEY",
        "STORAGE_PUBLIC_URL"
      ]) {
        if (!env2[variable]) {
          problems2.push(
            `${variable} is required when STORAGE_DRIVER=s3. Set ${variable}.`
          );
        }
      }
      if (env2.STORAGE_PUBLIC_URL) {
        try {
          const url = new URL(env2.STORAGE_PUBLIC_URL);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            problems2.push(
              "STORAGE_PUBLIC_URL must use http or https. Fix STORAGE_PUBLIC_URL."
            );
          }
        } catch {
          problems2.push(
            "STORAGE_PUBLIC_URL is not a valid URL (e.g. https://minio.example.com/prism). Fix STORAGE_PUBLIC_URL."
          );
        }
      }
    }
    if (driver === "imagekit" && !env2.IMAGE_KIT_API_KEY) {
      problems2.push(
        "IMAGE_KIT_API_KEY is required when STORAGE_DRIVER=imagekit. Set IMAGE_KIT_API_KEY."
      );
    }
  } catch (error) {
    problems2.push(error instanceof Error ? error.message : "Invalid STORAGE_DRIVER.");
  }
  problems2.push(...validateAllowedOrigins(env2));
  if (resolveDeploymentMode(env2) === "self-hosted") {
    const token = env2.SETUP_TOKEN;
    if (!token) {
      problems2.push(
        "SETUP_TOKEN is required for self-hosted deployments (the public first-owner setup endpoint must be token-protected). Generate one with: openssl rand -hex 24. Set SETUP_TOKEN."
      );
    } else if (token.length < 16) {
      problems2.push(
        "SETUP_TOKEN is too short (minimum 16 characters). Generate one with: openssl rand -hex 24."
      );
    }
  }
  return problems2;
}
function resolvePrismConfig(env2) {
  const problems2 = validatePrismConfig(env2);
  if (problems2.length > 0) {
    throw new Error(
      `Prism configuration is invalid:
${problems2.map((p) => `  - ${p}`).join("\n")}`
    );
  }
  return {
    deploymentMode: resolveDeploymentMode(env2),
    environment: resolveEnvironment(env2),
    instanceName: env2.INSTANCE_NAME?.trim() || "Prism",
    signupPolicy: resolveSignupPolicy(env2),
    baseUrl: env2.BASE_URL,
    clientUrl: env2.CLIENT_URL
  };
}

// src/auth/mail.ts
import { Resend } from "resend";
import nodemailer from "nodemailer";

// src/utils/generateEmailTemplates.ts
function generateConfirmEmailTemplate({
  name,
  confirmEmailLink
}) {
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
  <!DOCTYPE html>
  <html dir="ltr" lang="en">

    <head>
      <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
      <meta name="x-apple-disable-message-reformatting" />
    </head>

    <body style="background-color:#f6f9fc;padding:10px 0">
      <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;background-color:#ffffff;border:1px solid #f0f0f0;padding:45px;border-radius:6px">
        <tbody>
          <tr style="width:100%">
            <td style="font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:600;color:#111116;letter-spacing:-0.02em">&#9632;&nbsp;Prism</td>
              <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation">
                <tbody>
                  <tr>
                    <td>
                      <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Hi ${name},</p>
                      <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">You recently requested to verify your email for your Prism account.</p><a href="${confirmEmailLink}" style="line-height:100%;text-decoration:none;display:block;max-width:100%;background-color:#000000;border-radius:4px;color:#fff;font-family:&#x27;Open Sans&#x27;, &#x27;Helvetica Neue&#x27;, Arial;font-size:15px;text-align:center;width:210px;padding:14px 7px 14px 7px" target="_blank"><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%;mso-text-raise:21" hidden>&nbsp;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:10.5px">Confirm email</span><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]--></span></a>
                      <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">For security reasons, this link will expire in 48 hours.</p>
                      <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Thank you for using Prism.</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </body>

  </html>
    `;
}
function generateResetPasswordTemplate({
  name,
  resetLink
}) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <!DOCTYPE html>
    <html dir="ltr" lang="en">

      <head>
        <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
        <meta name="x-apple-disable-message-reformatting" />
      </head>

      <body style="background-color:#f6f9fc;padding:10px 0">
        <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;background-color:#ffffff;border:1px solid #f0f0f0;padding:45px;border-radius:6px">
          <tbody>
            <tr style="width:100%">
              <td style="font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:600;color:#111116;letter-spacing:-0.02em">&#9632;&nbsp;Prism</td>
                <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation">
                  <tbody>
                    <tr>
                      <td>
                        <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Hi ${name},</p>
                        <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">We received a request to reset your password for your Prism account. If you did not make this request, you can ignore this email. Otherwise, please follow the instructions below to reset your password.</p>
                        <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Click the link below to reset your password:</p><a href="${resetLink}" style="line-height:100%;text-decoration:none;display:block;max-width:100%;background-color:#000000;border-radius:4px;color:#fff;font-family:&#x27;Open Sans&#x27;, &#x27;Helvetica Neue&#x27;, Arial;font-size:15px;text-align:center;width:210px;padding:14px 7px 14px 7px" target="_blank"><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%;mso-text-raise:21" hidden>&nbsp;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:10.5px">Reset password</span><span><!--[if mso]><i style="letter-spacing: 7px;mso-font-width:-100%" hidden>&nbsp;</i><![endif]--></span></a>
                        <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">For security reasons, this link will expire in 8 hours. If the link has expired, you will need to request a new password reset.</p>
                        <p style="font-size:16px;line-height:26px;margin:16px 0;font-family:&#x27;Open Sans&#x27;, &#x27;HelveticaNeue-Light&#x27;, &#x27;Helvetica Neue Light&#x27;, &#x27;Helvetica Neue&#x27;, Helvetica, Arial, &#x27;Lucida Grande&#x27;, sans-serif;font-weight:300;color:#404040">Thank you for using Prism.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>

    </html>`;
}

// src/auth/mail.ts
var executor = null;
function setEmailExecutor(fn) {
  executor = fn;
}
function isMailConfigured(env2) {
  return Boolean(env2.MAIL_SMTP_HOST || env2.RESEND_API_KEY);
}
function scheduleEmail(env2, message) {
  const promise = dispatchEmail(env2, message).catch((error) => {
    console.warn(
      "[prism-auth][mail] delivery failed:",
      error instanceof Error ? error.message : error
    );
  });
  if (executor) {
    executor(promise);
  }
}
async function dispatchEmail(env2, message) {
  let html = "";
  switch (message.template) {
    case "confirm-email":
      html = generateConfirmEmailTemplate(message.props);
      break;
    case "reset-password":
      html = generateResetPasswordTemplate(message.props);
      break;
  }
  if (env2.MAIL_SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: env2.MAIL_SMTP_HOST,
      port: Number.parseInt(env2.MAIL_SMTP_PORT ?? "587", 10),
      secure: env2.MAIL_SMTP_SECURE === "true",
      auth: env2.MAIL_SMTP_USER && env2.MAIL_SMTP_PASS ? { user: env2.MAIL_SMTP_USER, pass: env2.MAIL_SMTP_PASS } : void 0
    });
    await transporter.sendMail({
      from: env2.MAIL_FROM ?? "Prism <no-reply@localhost>",
      to: message.to,
      subject: message.subject,
      html
    });
    return;
  }
  const apiKey = env2.RESEND_API_KEY;
  if (!apiKey) {
    if (resolveEnvironment(env2) !== "development") {
      console.warn(
        "[prism-auth][mail] delivery skipped: no production mail provider is configured. Set MAIL_SMTP_HOST (SMTP) or RESEND_API_KEY (Resend)."
      );
      return;
    }
    const link = message.template === "confirm-email" ? message.props.confirmEmailLink : message.props.resetLink;
    console.log(
      `[prism-auth][mail:${message.template}] To: ${message.to} \u2014 ${link}`
    );
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "Prism <onboarding@resend.dev>",
    to: [message.to],
    subject: message.subject,
    html
  });
  if (error) {
    console.warn(
      `[prism-auth][mail:${message.template}] delivery failed: ${error.message}`
    );
  }
}

// src/controllers/SetupController.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// src/auth/options.ts
import { jwt } from "better-auth/plugins";
import { github, google } from "better-auth/social-providers";

// src/auth/provision.ts
import { and, eq } from "drizzle-orm";

// src/database/schema/profiles.ts
import { pgTable as pgTable2, text as text2, timestamp as timestamp2, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// src/types/types.ts
var DatabaseTables = class {
  static {
    this.USERS = "user";
  }
  static {
    this.PROFILES = "profiles";
  }
  static {
    this.OAUTH_ACCESS_TOKENS = "oauth_access_tokens";
  }
  static {
    this.LOGIN_ATTEMPTS = "login_attempts";
  }
  static {
    this.OTP_SIGN_INS = "otp_sign_ins";
  }
  static {
    this.PROFILE_PICTURES = "profile_pictures";
  }
  static {
    this.TEAMS = "teams";
  }
  static {
    this.TEAM_MEMBERS = "team_members";
  }
  static {
    this.TEAM_AVATARS = "team_avatars";
  }
  static {
    this.TEAM_INVITES = "team_invites";
  }
  static {
    this.PROJECTS = "projects";
  }
  static {
    this.PROJECT_API_KEYS = "project_api_keys";
  }
};

// src/database/schema/auth.ts
var auth_exports = {};
__export(auth_exports, {
  account: () => account,
  accountRelations: () => accountRelations,
  jwks: () => jwks,
  session: () => session,
  sessionRelations: () => sessionRelations,
  user: () => user,
  userRelations: () => userRelations,
  verification: () => verification
});
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index
} from "drizzle-orm/pg-core";
var user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
  userName: text("user_name"),
  role: integer("role").default(1)
});
var session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);
var account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => /* @__PURE__ */ new Date()).notNull()
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);
var verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);
var jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at")
});
var userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account)
}));
var sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));
var accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));

// src/database/schema/profiles.ts
var profiles = pgTable2(
  DatabaseTables.PROFILES,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: text2("user_id").references(() => user.id, {
      onDelete: "cascade"
    }).notNull(),
    first_name: text2("first_name").notNull(),
    last_name: text2("last_name").notNull(),
    gender: text2("gender"),
    profile_picture_id: text2("profile_picture_id"),
    email_verified_at: timestamp2("email_verified_at", { withTimezone: true, mode: "string", precision: 6 }),
    created_at: timestamp2("created_at", { withTimezone: true, mode: "string", precision: 6 }).notNull().defaultNow(),
    updated_at: timestamp2("updated_at", { withTimezone: true, mode: "string", precision: 6 }).notNull().defaultNow()
  },
  (table) => {
    return {
      profileUserIdIndex: uniqueIndex("profile_user_id_index").on(table.user_id)
    };
  }
);

// src/database/schema/teams.ts
import { pgTable as pgTable3, text as text3, timestamp as timestamp3, uuid as uuid2, boolean as boolean2 } from "drizzle-orm/pg-core";
var teams = pgTable3(DatabaseTables.TEAMS, {
  id: uuid2("id").defaultRandom().primaryKey(),
  owner_id: text3("owner_id").references(() => user.id, {
    onDelete: "cascade"
  }).notNull(),
  name: text3("name").notNull(),
  is_personal: boolean2("is_personal").notNull(),
  logo_asset_id: text3("logo_asset_id"),
  created_at: timestamp3("created_at", {
    withTimezone: true,
    mode: "string",
    precision: 6
  }).notNull().defaultNow(),
  updated_at: timestamp3("updated_at", {
    withTimezone: true,
    mode: "string",
    precision: 6
  }).notNull().defaultNow()
});

// src/auth/provision.ts
function splitName(name, email) {
  const parts = name.trim().split(/\s+/);
  return {
    first_name: parts[0] ?? email,
    last_name: parts.slice(1).join(" ") || "-"
  };
}
async function provisionUserResources(db, user2) {
  const existingProfile = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.user_id, user2.id)).limit(1);
  if (existingProfile.length === 0) {
    const { first_name, last_name } = splitName(user2.name, user2.email);
    await db.insert(profiles).values({
      user_id: user2.id,
      first_name,
      last_name
    });
  }
  const existingTeam = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.owner_id, user2.id), eq(teams.is_personal, true))).limit(1);
  if (existingTeam.length === 0) {
    await db.insert(teams).values({
      owner_id: user2.id,
      name: `${user2.name}'s team`,
      is_personal: true
    });
  }
}

// src/auth/options.ts
function isProduction(env2) {
  return resolveEnvironment(env2) === "production";
}
function buildAuthOptions(env2, db) {
  const production = isProduction(env2);
  const baseURL = env2.BASE_URL ?? "http://localhost:8787";
  const trustedOrigins = [
    env2.CLIENT_URL ?? "http://localhost:3001",
    ...(env2.CORS_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
    // Development: trust any localhost/127.0.0.1 port so dev servers on
    // any port work; production stays locked to the explicit allowlist.
    // better-auth's matchesOriginPattern treats "*" as a wildcard.
    ...env2.ENVIRONMENT === "development" ? ["http://localhost:*", "http://127.0.0.1:*"] : []
  ].filter(Boolean);
  const githubEnabled = Boolean(
    env2.GITHUB_CLIENT_ID && env2.GITHUB_CLIENT_SECRET
  );
  const googleEnabled = Boolean(
    env2.GOOGLE_CLIENT_ID && env2.GOOGLE_CLIENT_SECRET
  );
  return {
    appName: "Prism",
    baseURL,
    secret: env2.JWT_SECRET_KEY ?? "",
    trustedOrigins,
    advanced: {
      // UUID-compatible ids keep Better Auth users valid FK targets for the
      // existing product tables (profiles, teams, memberships, projects).
      // Use an application-side generator because Better Auth treats
      // PostgreSQL as natively UUID-capable when this is the string "uuid"
      // and then inserts DEFAULT. Prism intentionally stores Better Auth IDs
      // in text columns, which have no database UUID default.
      database: {
        generateId: () => crypto.randomUUID()
      },
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: production
      },
      cookiePrefix: "prism"
    },
    user: {
      additionalFields: {
        userName: {
          type: "string",
          required: false,
          input: true
        },
        // Server-owned role: not writable through client or provider input.
        role: {
          type: "number",
          required: false,
          defaultValue: 1,
          input: false
        }
      }
    },
    emailAndPassword: {
      enabled: true,
      // Registration policy: open | invite-only | disabled (SIGNUP_POLICY,
      // with legacy ALLOW_PUBLIC_SIGNUP mapping). invite-only and disabled
      // close public signup; invites and the first-owner bootstrap remain.
      disableSignUp: resolveSignupPolicy(env2) !== "open",
      minPasswordLength: 8,
      sendResetPassword: async ({ user: user2, url }) => {
        scheduleEmail(env2, {
          to: user2.email,
          subject: "Password Reset Request for Your Prism Account",
          template: "reset-password",
          props: { name: user2.name, resetLink: url }
        });
      }
    },
    emailVerification: {
      // Product creation is guarded by email verification, so password
      // signups must receive the verification link immediately.
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user: user2, url }) => {
        scheduleEmail(env2, {
          to: user2.email,
          subject: "Confirm Email for your Prism Account",
          template: "confirm-email",
          props: { name: user2.name, confirmEmailLink: url }
        });
      },
      autoSignInAfterVerification: true
    },
    socialProviders: {
      ...githubEnabled ? {
        github: github({
          clientId: env2.GITHUB_CLIENT_ID ?? "",
          clientSecret: env2.GITHUB_CLIENT_SECRET ?? ""
        })
      } : {},
      ...googleEnabled ? {
        google: google({
          clientId: env2.GOOGLE_CLIENT_ID ?? "",
          clientSecret: env2.GOOGLE_CLIENT_SECRET ?? ""
        })
      } : {}
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user2) => {
            try {
              await provisionUserResources(db, user2);
            } catch (error) {
              if (typeof process !== "undefined" && process.env.VITEST === "true") {
                throw error;
              }
              console.warn(
                "[prism-auth] profile/team provisioning failed:",
                error instanceof Error ? error.message : error
              );
            }
          }
        }
      }
    },
    plugins: [
      jwt({
        jwt: {
          issuer: "prism",
          audience: "prism-analytics"
        },
        jwks: {
          keyPairConfig: { alg: "RS256" },
          rotationInterval: 60 * 60 * 24 * 30,
          // 30 days
          gracePeriod: 60 * 60 * 24 * 7
          // 7 days of overlap for rotation
        }
      })
    ]
  };
}

// src/database/db.ts
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";

// src/runtime.ts
var adapter = null;
function setRuntimeAdapter(next) {
  adapter = next;
}
function getRuntimeAdapter() {
  if (!adapter) {
    throw new Error(
      "No runtime adapter registered. Import the Worker or Node entry point (src/index.ts / src/index.node.ts)."
    );
  }
  return adapter;
}

// src/database/db.ts
function createProductDb(env2) {
  if (!env2.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Copy apps/api/.dev.vars.example (Worker) or apps/api/.env.example (Node) and fill it in."
    );
  }
  return getRuntimeAdapter().createProductDb(env2);
}
function createPostgresProductDb(env2) {
  const ssl = env2.DATABASE_URL?.includes("neon.tech") ? { ssl: "require" } : void 0;
  const sql = postgres(env2.DATABASE_URL, {
    max: 10,
    ...ssl ? { ssl } : {}
  });
  const rawSql = sql;
  const query = (strings, ...values) => rawSql(strings, ...values);
  query.query = async (sqlText, params) => rawSql.unsafe(sqlText, params ?? []);
  return {
    query,
    drizzle: drizzlePostgres(sql)
  };
}

// src/utils/RateLimiter.ts
var RateLimiter = class {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = /* @__PURE__ */ new Map();
  }
  hit(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count > this.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1e3)
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
  reset() {
    this.hits.clear();
  }
};
function clientIpFrom(ctx) {
  return ctx.req.header("cf-connecting-ip") || ctx.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

// src/controllers/SetupController.ts
import { Roles } from "@prism/types";

// src/network/responses/ErrorResponse.ts
var ErrorResponse = class {
  constructor(errors) {
    this.errors = typeof errors === "string" ? [errors] : errors;
  }
  toJSON() {
    return {
      errors: this.errors
    };
  }
};

// src/controllers/SetupController.ts
var CLAIM_TTL_MS = 5 * 60 * 1e3;
var SetupController = class _SetupController {
  static {
    this.limiter = new RateLimiter(15 * 60 * 1e3, 5);
  }
  /** Test hook: clear the per-IP rate-limit budget between cases. */
  static resetRateLimitForTests() {
    _SetupController.limiter.reset();
  }
  static async tokensEqual(provided, expected) {
    const encoder = new TextEncoder();
    const [providedDigest, expectedDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(provided)),
      crypto.subtle.digest("SHA-256", encoder.encode(expected))
    ]);
    const a = new Uint8Array(providedDigest);
    const b = new Uint8Array(expectedDigest);
    let difference = 0;
    for (let index2 = 0; index2 < a.length; index2++) {
      difference |= a[index2] ^ b[index2];
    }
    return difference === 0;
  }
  static async createOwner(ctx) {
    const env2 = ctx.env;
    const config = resolvePrismConfig(
      env2
    );
    if (config.deploymentMode !== "self-hosted") {
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }
    const attempt = _SetupController.limiter.hit(`setup:${clientIpFrom(ctx)}`);
    if (!attempt.allowed) {
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }
    const expectedToken = env2.SETUP_TOKEN ?? "";
    if (!expectedToken) {
      return ctx.json(new ErrorResponse("setup_not_enabled").toJSON(), 503);
    }
    const provided = ctx.req.header("x-setup-token") ?? "";
    if (!provided || !await _SetupController.tokensEqual(provided, expectedToken)) {
      return ctx.json(new ErrorResponse("setup_token_required").toJSON(), 401);
    }
    const productDb = createProductDb(
      env2
    );
    const db = productDb.drizzle;
    let userCount;
    try {
      const rows = await productDb.query`SELECT id FROM "user" LIMIT 1`;
      userCount = rows.length;
    } catch {
      return ctx.json(new ErrorResponse("database_not_ready").toJSON(), 503);
    }
    if (userCount > 0) {
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }
    try {
      await _SetupController.acquireClaim(productDb.query);
    } catch (error) {
      if (error instanceof Error && /no such table|does not exist|relation.*does not exist/i.test(
        error.message
      )) {
        console.warn(
          "[prism-setup] setup_claim table is missing \u2014 apply migrations (yarn workspace prism-api db:migrate)."
        );
        return ctx.json(new ErrorResponse("database_not_ready").toJSON(), 503);
      }
      return ctx.json(new ErrorResponse("setup_in_progress").toJSON(), 409);
    }
    let body;
    try {
      body = await ctx.req.json();
    } catch {
      await _SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }
    const name = body.name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    if (!name || !email || !password) {
      await _SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }
    if (password.length < 8) {
      await _SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("weak_password").toJSON(), 400);
    }
    const options = buildAuthOptions(
      env2,
      db
    );
    options.emailAndPassword = {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false
    };
    const auth = betterAuth({
      ...options,
      database: drizzleAdapter(db, { provider: "pg", schema: auth_exports })
    });
    const result = await auth.api.signUpEmail({
      body: { email, password, name }
    });
    if (!result || !result.user) {
      await _SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("signup_failed").toJSON(), 400);
    }
    const userId = result.user.id;
    try {
      await productDb.query`UPDATE "user" SET role = ${Roles.ADMIN}, email_verified = true WHERE id = ${userId}`;
      await provisionUserResources(db, {
        id: userId,
        name: result.user.name,
        email: result.user.email
      });
    } catch (error) {
      await _SetupController.rollbackOwner(productDb.query, userId);
      console.warn(
        "[prism-setup] owner promotion/provisioning failed, rolled back:",
        error instanceof Error ? error.message : error
      );
      return ctx.json(new ErrorResponse("signup_failed").toJSON(), 500);
    }
    return ctx.json({ ok: true });
  }
  /**
   * Inserts the single claim row. On conflict it inspects the existing
   * row: a claim older than the TTL is stale (the previous request
   * crashed) and is removed before one retry; a fresh claim belongs to a
   * live request, so the caller reports the conflict.
   */
  static async acquireClaim(query) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await query`INSERT INTO setup_claim (id, claimed_at) VALUES (1, ${Date.now()})`;
        return;
      } catch (error) {
        if (attempt > 0) {
          throw error;
        }
        const rows = await query`SELECT claimed_at FROM setup_claim WHERE id = 1`;
        const claimedAt = Number(rows[0]?.claimed_at ?? 0);
        if (rows.length > 0 && Date.now() - claimedAt > CLAIM_TTL_MS) {
          await query`DELETE FROM setup_claim WHERE id = 1`;
          continue;
        }
        throw error;
      }
    }
  }
  /** Removes the claim row so setup can be retried (failure path). */
  static async releaseClaim(query) {
    try {
      await query`DELETE FROM setup_claim WHERE id = 1`;
    } catch {
    }
  }
  /** Compensating transaction: undo the created account on failure. */
  static async rollbackOwner(query, userId) {
    try {
      await query`DELETE FROM session WHERE user_id = ${userId}`;
      await query`DELETE FROM account WHERE user_id = ${userId}`;
      await query`DELETE FROM verification WHERE identifier IN (SELECT email FROM "user" WHERE id = ${userId})`;
      await query`DELETE FROM "user" WHERE id = ${userId}`;
      await _SetupController.releaseClaim(query);
    } catch (error) {
      console.warn(
        "[prism-setup] rollback incomplete:",
        error instanceof Error ? error.message : error
      );
    }
  }
};

// src/managers/DatabaseManager.ts
var DatabaseManager = class _DatabaseManager {
  static {
    this.instance = null;
  }
  static getInstance(ctx) {
    if (!_DatabaseManager.instance) {
      _DatabaseManager.instance = createProductDb(
        ctx.env
      ).query;
    }
    return _DatabaseManager.instance;
  }
};

// src/routers/UserRouter.ts
import { Hono } from "hono";

// src/controllers/UserController.ts
import {
  UpdateUserInformationRequestSchema
} from "@prism/types";

// src/utils/parseError.ts
function parseError(error) {
  const list = [];
  try {
    for (const issue of error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : "";
      const message = issue.message;
      if (field) {
        list.push(`"${field}" ${message}`);
      } else {
        list.push(message);
      }
    }
  } catch (_) {
    return list;
  }
  return list;
}

// src/utils/validateData.ts
function validateData(schema, data) {
  try {
    return schema.parse(data, {});
  } catch (error) {
    return parseError(error);
  }
}

// src/utils/validateImageFile.ts
var MAX_IMAGE_SIZE = 5e6;
var ACCEPTED_MIME_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heif",
  "image/heic"
]);
var Uint8 = Uint8Array;
function startsWith(bytes, expected, offset = 0) {
  return expected.every((byte, index2) => bytes[offset + index2] === byte);
}
function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
function signatureMatches(mimeType, bytes) {
  switch (mimeType) {
    case "image/jpeg":
      return startsWith(bytes, [255, 216, 255]);
    case "image/png":
      return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/gif":
      return ascii(bytes, 0, 4) === "GIF8";
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "image/heif":
    case "image/heic":
      return ascii(bytes, 4, 4) === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
        ascii(bytes, 8, 4)
      );
    default:
      return false;
  }
}
async function validateImageFile(file) {
  if (!file) {
    return ["file_not_found"];
  }
  const errors = [];
  if (file.size > MAX_IMAGE_SIZE) {
    errors.push("file_too_large");
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    errors.push("file_type_not_supported");
  }
  const signature = new Uint8(await file.slice(0, 16).arrayBuffer());
  if (!signatureMatches(file.type, signature)) {
    errors.push("file_signature_mismatch");
  }
  return errors;
}

// src/network/responses/ProfileResponse.ts
var ProfileResponse = class {
  constructor(profile) {
    this.profile = profile;
  }
  toJSON() {
    return {
      firstName: this.profile.first_name,
      lastName: this.profile.last_name,
      gender: this.profile.gender,
      profilePictureUrl: this.profile.profile_picture_url || null,
      emailVerifiedAt: this.profile.email_verified_at ? new Date(this.profile.email_verified_at).toISOString() : null
    };
  }
};

// src/network/responses/UserResponse.ts
var UserResponse = class {
  constructor(user2, profile) {
    this.user = user2;
    this.profile = profile;
  }
  toJSON() {
    return {
      id: this.user.id,
      email: this.user.email,
      role: this.user.role ?? 1,
      userName: this.user.userName ?? null,
      profile: this.profile ? new ProfileResponse(this.profile).toJSON() : null
    };
  }
};

// src/managers/StorageManager.ts
function buildKey(file, folder, fileName) {
  const base = fileName?.trim() || randomId();
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  const stem = base.replace(/\.[^/.]+$/, "") || randomId();
  const folderPath = folder.replace(/^\/+|\/+$/g, "");
  return `${folderPath}/${stem}-${randomId()}${extension}`;
}
function randomId() {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
var imagekitDriver = (env2) => ({
  async upload(file, folder, fileName) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", `${env2.PROJECT_NAME ?? "prism"}${folder}`);
    formData.append("fileName", fileName || randomId());
    const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Basic ${btoa(`${env2.IMAGE_KIT_API_KEY}:`)}`
      }
    });
    if (!response.ok) {
      console.warn(
        "[prism-storage] imagekit upload failed:",
        response.status
      );
      return null;
    }
    const data = await response.json();
    return { fileId: data.fileId, name: data.name, url: data.url, size: data.size };
  },
  async delete(fileId) {
    await fetch(`https://api.imagekit.io/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(`${env2.IMAGE_KIT_API_KEY}:`)}`,
        "Content-Type": "application/json"
      }
    });
  }
});
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hmac(key, data) {
  const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
  const importable = new Uint8Array(raw.byteLength);
  importable.set(raw);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    importable,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(data)
    )
  );
}
async function signatureKey(secret, dateStamp, region) {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}
async function signedRequest(cfg, method, key, body) {
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(cfg.endpoint).host;
  const payloadHash = await sha256Hex(body ?? "");
  const canonicalHeaders = `host:${host}
x-amz-content-sha256:${payloadHash}
x-amz-date:${amzDate}
`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalUri = `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalRequest = `${method}
${canonicalUri}

${canonicalHeaders}
${signedHeaders}
${payloadHash}`;
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256
${amzDate}
${scope}
${await sha256Hex(canonicalRequest)}`;
  const signingKey = await signatureKey(cfg.secretKey, dateStamp, cfg.region);
  const signature = Array.from(await hmac(signingKey, stringToSign)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return fetch(`${cfg.endpoint}${canonicalUri}`, {
    method,
    headers: {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body: body ?? void 0
  });
}
var s3Driver = (env2) => {
  const cfg = {
    endpoint: (env2.STORAGE_S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: env2.STORAGE_S3_REGION ?? "us-east-1",
    bucket: env2.STORAGE_S3_BUCKET ?? "",
    accessKey: env2.STORAGE_S3_ACCESS_KEY_ID ?? "",
    secretKey: env2.STORAGE_S3_SECRET_ACCESS_KEY ?? ""
  };
  const publicUrl = (env2.STORAGE_PUBLIC_URL ?? "").replace(/\/+$/, "");
  return {
    async upload(file, folder, fileName) {
      const key = buildKey(file, folder, fileName);
      const response = await signedRequest(
        cfg,
        "PUT",
        key,
        await file.arrayBuffer()
      );
      if (!response.ok) {
        console.warn(
          "[prism-storage] s3 upload failed:",
          response.status,
          await response.text().catch(() => "")
        );
        return null;
      }
      return {
        fileId: key,
        name: key.split("/").pop() ?? key,
        url: `${publicUrl}/${key}`,
        size: file.size
      };
    },
    async delete(key) {
      const response = await signedRequest(cfg, "DELETE", key);
      if (!response.ok) {
        console.warn(
          "[prism-storage] s3 delete failed:",
          response.status,
          await response.text().catch(() => "")
        );
      }
    }
  };
};
var localDriver = (env2) => {
  const dir = env2.STORAGE_LOCAL_DIR ?? "./data/uploads";
  const baseUrl = env2.BASE_URL ?? "http://localhost:8787";
  return {
    async upload(file, folder, fileName) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const key = buildKey(file, folder, fileName);
      const full = path.join(dir, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(await file.arrayBuffer()));
      return {
        fileId: key,
        name: key.split("/").pop() ?? key,
        url: `${baseUrl}/files/${key}`,
        size: file.size
      };
    },
    async delete(key) {
      const { unlink } = await import("node:fs/promises");
      const path = await import("node:path");
      const full = path.resolve(dir, key);
      if (!full.startsWith(path.resolve(dir) + path.sep)) {
        return;
      }
      await unlink(full).catch(() => void 0);
    }
  };
};
var StorageManager = class _StorageManager {
  static getDriver(ctx) {
    const env2 = ctx.env;
    const config = resolvePrismConfig(env2);
    switch (resolveStorageDriver(env2)) {
      case "imagekit":
        return imagekitDriver(env2);
      case "s3":
        return s3Driver(env2);
      case "local":
        return localDriver(env2);
      default:
        throw new Error(`Unsupported STORAGE_DRIVER for ${config.deploymentMode}.`);
    }
  }
  static async uploadSingle(ctx, file, folder, fileName) {
    return _StorageManager.getDriver(ctx).upload(file, folder, fileName);
  }
  static async deleteFile(ctx, fileId) {
    await _StorageManager.getDriver(ctx).delete(fileId);
  }
  /** Absolute local path for the /files/* static route (local driver). */
  static async localFilePath(ctx, key) {
    const env2 = ctx.env;
    if (resolveStorageDriver(env2) !== "local") {
      return null;
    }
    const { resolve, sep } = await import("node:path");
    const dir = resolve(env2.STORAGE_LOCAL_DIR ?? "./data/uploads");
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
    }
    const full = resolve(dir, decoded);
    if (!full.startsWith(dir + sep)) {
      return null;
    }
    return full;
  }
};

// src/network/responses/ProfilePictureResponse.ts
var ProfilePictureResponse = class {
  constructor(profilePicture) {
    this.profilePicture = profilePicture;
  }
  toJSON() {
    return {
      profilePictureUrl: this.profilePicture
    };
  }
};

// src/controllers/UserController.ts
var UserController = class {
  /**
   * Returns the authenticated Prism user (identity from Better Auth) with
   * their product profile (first/last name, avatar, verification state).
   */
  static async currentUser(ctx) {
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const profile = await DatabaseManager.getInstance(
      ctx
    )`SELECT * FROM profiles WHERE user_id = ${user2.id} LIMIT 1`;
    return ctx.json(
      new UserResponse(user2, profile[0] ?? null).toJSON()
    );
  }
  static async updateProfilePicture(ctx) {
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const body = await ctx.req.parseBody();
    const file = body.file;
    if (!file) {
      return ctx.json(new ErrorResponse("file_not_found").toJSON(), 400);
    }
    const validationErrors = await validateImageFile(file);
    if (validationErrors.length > 0) {
      return ctx.json(new ErrorResponse(validationErrors).toJSON(), 400);
    }
    const uploadResult = await StorageManager.uploadSingle(
      ctx,
      file,
      "/users/profile-pictures",
      `${file.name}`
    );
    if (!uploadResult) {
      return ctx.json(new ErrorResponse("file_not_uploaded").toJSON(), 400);
    }
    const db = DatabaseManager.getInstance(ctx);
    const profilePicture = await db`SELECT profile_picture_id, user_id FROM profile_pictures WHERE user_id = ${user2.id}`;
    if (profilePicture.length > 0) {
      await StorageManager.deleteFile(
        ctx,
        profilePicture[0].profile_picture_id
      );
      await db`DELETE FROM profile_pictures WHERE user_id = ${profilePicture[0].user_id}`;
    }
    await db`INSERT INTO profile_pictures (user_id, profile_picture_url, profile_picture_id) VALUES (${user2.id}, ${uploadResult.url}, ${uploadResult.fileId})`;
    return ctx.json(new ProfilePictureResponse(uploadResult.url).toJSON());
  }
  static async updateUserInformation(ctx) {
    const body = await ctx.req.json();
    const data = validateData(UpdateUserInformationRequestSchema, body);
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const updated = await DatabaseManager.getInstance(ctx)`
      UPDATE profiles SET first_name = ${data.firstName}, last_name = ${data.lastName}
      WHERE user_id = ${user2.id} RETURNING *
    `;
    if (updated.length === 0) {
      return ctx.json(new ErrorResponse("profile_not_updated").toJSON(), 400);
    }
    return ctx.json(
      new UserResponse(user2, updated[0]).toJSON()
    );
  }
};

// src/middlewares/AuthenticationMiddleware.ts
import { createMiddleware } from "hono/factory";

// src/auth/auth.ts
import { betterAuth as betterAuth2 } from "better-auth";
import { drizzleAdapter as drizzleAdapter2 } from "better-auth/adapters/drizzle";
var cached = null;
function getAuth(env2) {
  if (!cached) {
    const db = createProductDb(
      env2
    ).drizzle;
    cached = betterAuth2({
      ...buildAuthOptions(
        env2,
        db
      ),
      database: drizzleAdapter2(db, { provider: "pg", schema: auth_exports })
    });
  }
  return cached;
}

// src/middlewares/AuthenticationMiddleware.ts
var AuthenticationMiddleware = createMiddleware(
  async (ctx, next) => {
    try {
      const auth = getAuth(ctx.env);
      const session2 = await auth.api.getSession({
        headers: ctx.req.raw.headers
      });
      if (!session2) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }
      ctx.set("user", session2.user);
    } catch {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  }
);
var RequireVerifiedEmailMiddleware = createMiddleware(
  async (ctx, next) => {
    const user2 = ctx.get("user");
    if (!user2?.emailVerified) {
      return ctx.json(
        new ErrorResponse("email_not_verified").toJSON(),
        403
      );
    }
    await next();
  }
);

// src/routers/UserRouter.ts
var router = new Hono();
router.use(AuthenticationMiddleware);
router.get("/", UserController.currentUser);
router.put("/", UserController.updateUserInformation);
router.put("/update-profile-picture", UserController.updateProfilePicture);

// src/routers/TeamsRouter.ts
import { createMiddleware as createMiddleware2 } from "hono/factory";
import { Hono as Hono2 } from "hono";

// src/managers/TursoDatabaseManager.ts
import { createClient } from "@libsql/client/web";
var TursoDatabaseManager = class _TursoDatabaseManager {
  static {
    this.instance = null;
  }
  static {
    this.warned = false;
  }
  static getInstance(ctx) {
    if (_TursoDatabaseManager.instance) {
      return _TursoDatabaseManager.instance;
    }
    const url = ctx.env.TURSO_DATABASE_URL;
    if (!url) {
      if (resolveDeploymentMode(ctx.env) !== "self-hosted") {
        throw new Error(
          "TURSO_DATABASE_URL is required in hosted mode (analytics store). Set TURSO_DATABASE_URL."
        );
      }
      if (!_TursoDatabaseManager.warned) {
        _TursoDatabaseManager.warned = true;
        console.warn(
          "[prism-api] TURSO_DATABASE_URL is not set: analytics reads return empty. Set it to enable events/sessions on this instance."
        );
      }
      _TursoDatabaseManager.instance = {
        execute: async () => ({ rows: [] })
      };
      return _TursoDatabaseManager.instance;
    }
    _TursoDatabaseManager.instance = createClient({
      url,
      authToken: ctx.env.TURSO_AUTH_TOKEN
    });
    return _TursoDatabaseManager.instance;
  }
};

// src/network/responses/TeamResponse.ts
var TeamResponse = class {
  constructor(team) {
    this.team = team;
  }
  toJSON() {
    return {
      id: this.team.id,
      name: this.team.name,
      isPersonal: this.team.is_personal,
      avatarUrl: this.team.avatar_url,
      ownerId: this.team.owner_id
    };
  }
};

// src/controllers/TeamsController.ts
import {
  CreateTeamRequestSchema,
  SendTeamInvitesRequestSchema,
  TeamMemberPermissions
} from "@prism/types";

// src/network/responses/OkResponse.ts
var OkResponse = class {
  constructor(message) {
    this.message = message || "success";
  }
  toJSON() {
    return {
      message: this.message
    };
  }
};

// src/controllers/TeamsController.ts
import jwt2 from "@tsndr/cloudflare-worker-jwt";
import { addDays } from "date-fns/addDays";

// src/network/responses/TeamInviteResponse.ts
var TeamInviteResponse = class {
  constructor(team) {
    this.team = team;
  }
  toJSON() {
    return {
      id: this.team.id,
      name: this.team.name,
      avatarUrl: this.team.avatar_url
    };
  }
};

// src/network/responses/TeamInviteLinkResponse.ts
var TeamInviteLinkResponse = class {
  constructor(teamInviteUrl) {
    this.teamInviteUrl = teamInviteUrl;
  }
  toJSON() {
    return {
      teamInviteUrl: this.teamInviteUrl
    };
  }
};

// src/utils/groupSessionsByDateAndPlatform.ts
function groupSessionsByDateAndPlatform(sessions, duration) {
  const countMap = /* @__PURE__ */ new Map();
  const endDate = /* @__PURE__ */ new Date();
  const startDate = new Date(endDate);
  switch (duration) {
    case "24-hours":
      startDate.setHours(startDate.getHours() - 24);
      break;
    case "seven-days":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "two-weeks":
      startDate.setDate(startDate.getDate() - 14);
      break;
    case "one-month":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "one-year":
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 3);
  }
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    countMap.set(d.toISOString().split("T")[0], {
      mobileCount: 0,
      desktopCount: 0
    });
  }
  for (const session2 of sessions) {
    const date = session2.created_at.split(" ")[0];
    if (new Date(date) >= startDate && new Date(date) <= endDate) {
      const counts = countMap.get(date) || { mobileCount: 0, desktopCount: 0 };
      if (session2.is_mobile === 1) {
        counts.mobileCount++;
      } else {
        counts.desktopCount++;
      }
      countMap.set(date, counts);
    }
  }
  return Array.from(countMap, ([date, counts]) => ({
    date,
    mobile: counts.mobileCount,
    desktop: counts.desktopCount
  }));
}

// src/network/responses/ProjectResponse.ts
var ProjectResponse = class {
  constructor(project, sessionData) {
    this.project = project;
    this.sessionData = sessionData;
  }
  toJSON() {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      summary: groupSessionsByDateAndPlatform(this.sessionData, "seven-days")
    };
  }
};

// src/controllers/TeamsController.ts
var TeamsController = class _TeamsController {
  static async teams(ctx) {
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const userCreatedTeams = await db`
        SELECT
          teams.id as id,
          teams.owner_id as owner_id,
          teams.is_personal as is_personal,
          teams.name as name,
          team_avatars.image_asset_url as avatar_url
        FROM teams
        LEFT JOIN team_avatars ON teams.id = team_avatars.team_id
        WHERE owner_id = ${user2.id}
        ORDER BY teams.created_at ASC
        `;
    const userTeams = await db`
        SELECT
          teams.id as id,
          teams.owner_id as owner_id,
          teams.is_personal as is_personal,
          teams.name as name,
          team_avatars.image_asset_url as avatar_url
        FROM teams
        RIGHT JOIN team_members
        ON team_members.team_id = teams.id
        LEFT JOIN team_avatars
        ON teams.id = team_avatars.team_id
        WHERE team_members.user_id = ${user2.id}`;
    return ctx.json(
      [...userCreatedTeams, ...userTeams].map(
        (team) => new TeamResponse(team).toJSON()
      )
    );
  }
  static async getTeamInvite(ctx) {
    const token = ctx.req.param("token");
    if (!token) {
      return ctx.json(new ErrorResponse("token_not_found").toJSON(), 404);
    }
    const isValid = await jwt2.verify(token, ctx.env.JWT_SECRET_KEY);
    if (!isValid) {
      return ctx.json(new ErrorResponse("token_invalid").toJSON(), 400);
    }
    const decodedToken = jwt2.decode(token);
    if (!decodedToken.payload?.teamId) {
      return ctx.json(new ErrorResponse("token_invalid").toJSON(), 400);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`
        SELECT teams.name as name, team_avatars.image_asset_url as avatar_url, teams.id as id
        FROM teams
        LEFT JOIN team_avatars
        ON teams.id = team_avatars.team_id
        WHERE teams.id = ${decodedToken.payload.teamId}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("token_not_found").toJSON(), 404);
    }
    return ctx.json(new TeamInviteResponse(team[0]).toJSON());
  }
  static async createTeam(ctx) {
    const body = await ctx.req.json();
    const data = validateData(CreateTeamRequestSchema, body);
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const userTeams = await db`SELECT * FROM teams WHERE owner_id = ${user2.id}`;
    if (userTeams.length >= 10) {
      return ctx.json(
        new ErrorResponse("max_number_teams_exceeded").toJSON(),
        400
      );
    }
    const team = await db`INSERT INTO teams (owner_id, name, is_personal) VALUES (${user2.id}, ${data.name}, FALSE) RETURNING *`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("db_error"), 500);
    }
    return ctx.json(new TeamResponse(team[0]).toJSON());
  }
  static async sendInvites(ctx) {
    const teamId = ctx.req.param("teamId");
    const body = await ctx.req.json();
    const data = validateData(SendTeamInvitesRequestSchema, {
      teamId,
      emails: body.emails
    });
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id, is_personal, name FROM teams WHERE id = ${data.teamId} AND is_personal = FALSE AND owner_id = ${user2.id}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }
    const teamMembers = await db`
        SELECT
          users.email as email
        FROM team_members
        JOIN users
        ON team_members.user_id = users.id
        WHERE team_members.team_id = ${data.teamId}
        `;
    const pendingInvites = await db`SELECT email FROM team_invites WHERE team_id = ${data.teamId} AND status = 'pending'`;
    const pendingInvitesEmails = pendingInvites.map(({ email }) => email);
    const teamMembersEmails = teamMembers.map(({ email }) => email);
    let newTeamMembers = data.emails.filter(
      (value) => !teamMembersEmails.includes(value)
    );
    newTeamMembers = newTeamMembers.filter(
      (value) => !pendingInvitesEmails.includes(value)
    );
    if (newTeamMembers.length === 0) {
      return ctx.json(new OkResponse().toJSON());
    }
    const values = newTeamMembers.map((email) => [
      `${team[0].id}`,
      `${email}`,
      "pending"
    ]);
    const placeholders = values.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(", ");
    await db.query(
      `INSERT INTO team_invites(team_id, email, status) VALUES ${placeholders} RETURNING id;`,
      values.flat()
    );
    const inviteUrl = await _TeamsController._generateInviteUrl(ctx, team[0].id);
    return ctx.json(new OkResponse(inviteUrl).toJSON());
  }
  static async joinTeam(ctx) {
    const teamId = ctx.req.param("teamId");
    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 404);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id, owner_id FROM teams WHERE id = ${teamId}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }
    if (team[0].owner_id === user2.id) {
      return ctx.json(new ErrorResponse("team_owner").toJSON(), 400);
    }
    const teamMembers = await db`SELECT id FROM team_members WHERE user_id = ${user2.id} AND team_id = ${teamId}`;
    if (teamMembers.length > 0) {
      return ctx.json(new ErrorResponse("already_a_team_member").toJSON(), 400);
    }
    const newTeamMember = await db`INSERT INTO team_members (user_id, team_id, permission_id) VALUES (${user2.id}, ${teamId}, ${TeamMemberPermissions.BASIC}) RETURNING id`;
    if (newTeamMember.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }
    return ctx.json(new OkResponse().toJSON());
  }
  static async leaveTeam(ctx) {
    const teamId = ctx.req.param("teamId");
    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 404);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id, owner_id FROM teams WHERE id = ${teamId}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }
    if (team[0].owner_id === user2.id) {
      return ctx.json(new ErrorResponse("team_owner").toJSON(), 400);
    }
    const deleted = await db`DELETE FROM team_members WHERE user_id = ${user2.id} AND team_id = ${teamId} RETURNING id`;
    if (deleted.length === 0) {
      return ctx.json(
        new ErrorResponse("team_membership_not_found").toJSON(),
        404
      );
    }
    return ctx.json(new OkResponse().toJSON());
  }
  static async deleteTeam(ctx) {
    const teamId = ctx.req.param("teamId");
    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 401);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id FROM teams WHERE id = ${teamId} AND owner_id = ${user2.id} AND is_personal = FALSE`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }
    await db`DELETE FROM teams WHERE id = ${teamId} `;
    return ctx.json(new OkResponse().toJSON());
  }
  static async projects(ctx) {
    const teamId = ctx.req.param("teamId");
    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT owner_id FROM teams WHERE id = ${teamId}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 400);
    }
    const teamMembers = await db`SELECT id FROM team_members WHERE team_id = ${teamId} AND user_id = ${user2.id}`;
    if (teamMembers.length === 0 && team[0].owner_id !== user2.id) {
      return ctx.json([]);
    }
    const projects = await db`SELECT id, slug, name FROM projects WHERE team_id = ${teamId} ORDER BY created_at DESC `;
    if (projects.length === 0) {
      return ctx.json([]);
    }
    const placeholders = projects.map((_) => "?").join(",");
    const ids = projects.map(({ id }) => id);
    const { rows: sessionResults } = await TursoDatabaseManager.getInstance(
      ctx
    ).execute({
      sql: `SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-7 days') AND datetime('now') AND project_id IN (${placeholders})`,
      args: ids
    });
    return ctx.json(
      projects.map((project) => {
        const sessionData = sessionResults.filter(
          ({ project_id }) => project_id === project.id
        );
        return new ProjectResponse(project, sessionData).toJSON();
      })
    );
  }
  static async getTeamInviteLink(ctx) {
    const teamId = ctx.req.param("teamId");
    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 401);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id FROM teams WHERE id = ${teamId} AND owner_id = ${user2.id} AND is_personal = FALSE`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }
    const inviteLink = await _TeamsController._generateInviteUrl(ctx, teamId);
    return ctx.json(new TeamInviteLinkResponse(inviteLink).toJSON());
  }
  static async _generateInviteUrl(ctx, teamId) {
    const expiryAt = addDays(/* @__PURE__ */ new Date(), 14);
    const jwtToken = await jwt2.sign(
      {
        teamId,
        expiryAt: expiryAt.getTime()
      },
      ctx.env.JWT_SECRET_KEY,
      {
        algorithm: "HS256"
      }
    );
    return `${ctx.env.CLIENT_URL}/join?token=${jwtToken}`;
  }
};

// src/routers/TeamsRouter.ts
var router2 = new Hono2();
var inviteLimiter = new RateLimiter(6e4, 10);
var inviteRateLimit = createMiddleware2(async (ctx, next) => {
  const { allowed, retryAfterSeconds } = inviteLimiter.hit(clientIpFrom(ctx));
  if (!allowed) {
    ctx.header("Retry-After", String(retryAfterSeconds));
    return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
  }
  await next();
});
router2.get("/invite/:token", TeamsController.getTeamInvite);
router2.use(AuthenticationMiddleware);
router2.get("/", TeamsController.teams);
router2.post("/", RequireVerifiedEmailMiddleware, TeamsController.createTeam);
router2.get("/:teamId/invite-link", TeamsController.getTeamInviteLink);
router2.get("/:teamId/projects", TeamsController.projects);
router2.delete("/:teamId", TeamsController.deleteTeam);
router2.post(
  "/:teamId/send-invites",
  RequireVerifiedEmailMiddleware,
  inviteRateLimit,
  TeamsController.sendInvites
);
router2.post("/:teamId/join", TeamsController.joinTeam);
router2.post("/:teamId/leave", TeamsController.leaveTeam);

// src/routers/ProjectsRouter.ts
import { Hono as Hono3 } from "hono";

// src/utils/generateProjectSlug.ts
function generateProjectSlug() {
  const id = Math.round(Math.random() * 1e9);
  const first = firstKey[Math.floor(Math.random() * firstKey.length)];
  const second = secondKey[Math.floor(Math.random() * secondKey.length)];
  return `${first.toLowerCase()}-${second.toLowerCase()}-${id}`;
}
var firstKey = [
  "Red",
  "Blue",
  "Green",
  "Yellow",
  "Purple",
  "Orange",
  "Pink",
  "Brown",
  "Black",
  "White",
  "Gray",
  "Cyan",
  "Magenta",
  "Lime",
  "Teal",
  "Lavender",
  "Maroon",
  "Navy",
  "Olive",
  "Turquoise",
  "Beige",
  "Coral",
  "Crimson",
  "Gold",
  "Silver",
  "Indigo",
  "Violet",
  "Plum",
  "Khaki",
  "Tan",
  "Salmon",
  "Peach",
  "Mint",
  "Periwinkle",
  "Mauve",
  "Burgundy",
  "Chartreuse",
  "Fuchsia",
  "Mustard",
  "Ivory",
  "Rust",
  "Bronze",
  "Sapphire",
  "Ruby",
  "Emerald",
  "Amethyst",
  "Jade",
  "Pearl",
  "Amber",
  "Cobalt",
  "Aquamarine",
  "Lilac",
  "Cream",
  "Sienna",
  "Scarlet",
  "Cerulean",
  "Mahogany",
  "Sepia",
  "Sangria",
  "Taupe",
  "Puce",
  "Marigold",
  "Apricot",
  "Celadon",
  "Eggplant",
  "Goldenrod",
  "Honeydew",
  "Iris",
  "Jasmine",
  "Kiwi",
  "Lemon",
  "Mango",
  "Nectarine",
  "Onyx",
  "Papaya",
  "Quartz",
  "Raspberry",
  "Saffron",
  "Tangerine",
  "Ultramarine",
  "Vermilion",
  "Wisteria",
  "Xanadu",
  "Yam",
  "Zaffre",
  "Alabaster",
  "Byzantium",
  "Cerise",
  "Denim",
  "Ecru",
  "Fawn"
];
var secondKey = [
  "Oatmeal",
  "Pancakes",
  "Waffles",
  "Eggs",
  "Bacon",
  "Sausage",
  "Toast",
  "Bagel",
  "Muffin",
  "Cereal",
  "Yogurt",
  "Granola",
  "Fruit",
  "Velvet",
  "Smoothie",
  "Croissant",
  "Omelet",
  "Hashbrowns",
  "Grits",
  "Biscuits",
  "Scone",
  "Porridge",
  "Frittata",
  "Quiche",
  "Crepes",
  "French-toast",
  "Avocado",
  "Acai",
  "Shakshuka",
  "rancheros",
  "Congee"
];

// src/controllers/ProjectsController.ts
import {
  CreateProjectRequestSchema,
  RenameProjectRequestSchema,
  TeamMemberPermissions as TeamMemberPermissions2
} from "@prism/types";

// src/network/responses/ProjectDetailedResponse.ts
var ProjectDetailedResponse = class {
  constructor(project, analytics) {
    this.project = project;
    this.analytics = analytics;
  }
  toJSON() {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      apiKey: this.project.api_key,
      teamId: this.project.team_id,
      analytics: this.analytics
    };
  }
};

// src/utils/generateApiKey.ts
import { v4 } from "uuid";
function generateApiKey() {
  return `pr_${v4().toString().replaceAll("-", "")}`;
}

// src/utils/groupByBrowsers.ts
function groupByBrowsers(sessions) {
  const map = /* @__PURE__ */ new Map();
  map.set("Firefox", 0);
  map.set("Chrome", 0);
  map.set("Safari", 0);
  map.set("Opera", 0);
  map.set("Edge", 0);
  map.set("Internet Explorer", 0);
  for (const { browser } of sessions) {
    const oldValue = map.get(browser);
    if (oldValue !== void 0) {
      map.set(browser, oldValue + 1);
    } else {
      map.set(browser, 1);
    }
  }
  return map;
}

// src/utils/groupByOs.ts
function groupByOs(sessions) {
  const map = /* @__PURE__ */ new Map();
  map.set("Windows", 0);
  map.set("macOS", 0);
  map.set("Linux", 0);
  map.set("Android", 0);
  map.set("iOS", 0);
  for (const { os } of sessions) {
    const oldValue = map.get(os);
    if (oldValue !== void 0) {
      map.set(os, oldValue + 1);
    } else {
      map.set(os, 1);
    }
  }
  return map;
}

// src/utils/groupByCountry.ts
function groupByCountry(sessions) {
  const map = /* @__PURE__ */ new Map();
  for (const { country_code } of sessions) {
    if (!country_code)
      continue;
    const oldValue = map.get(country_code);
    if (oldValue !== void 0) {
      map.set(country_code, oldValue + 1);
    } else {
      map.set(country_code, 1);
    }
  }
  return map;
}

// src/controllers/ProjectsController.ts
var ProjectsController = class _ProjectsController {
  static async createProject(ctx) {
    const body = await ctx.req.json();
    const data = validateData(CreateProjectRequestSchema, body);
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const team = await db`SELECT id, owner_id FROM teams WHERE id = ${data.teamId}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }
    const hasPermission = await _ProjectsController._hasAdminPermission(
      ctx,
      team[0]
    );
    if (!hasPermission) {
      return ctx.json(new ErrorResponse("cannot_create_project").toJSON(), 400);
    }
    const projectSlug = generateProjectSlug();
    const project = await db`INSERT INTO projects (name, team_id, creator_id, slug) VALUES (${data.name}, ${data.teamId}, ${user2.id}, ${projectSlug}) RETURNING id`;
    if (project.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }
    await db`INSERT INTO project_api_keys (team_id, project_id, key) VALUES (${data.teamId}, ${project[0].id}, ${generateApiKey()})`;
    return ctx.json(new OkResponse().toJSON());
  }
  static async deleteProject(ctx) {
    const projectId = ctx.req.param("projectId");
    if (!projectId) {
      return ctx.json(new ErrorResponse("project_id_not_found").toJSON(), 404);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const project = await db`SELECT id, team_id FROM projects WHERE id = ${projectId}`;
    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const team = await db`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }
    const hasPermission = await _ProjectsController._hasAdminPermission(
      ctx,
      team[0]
    );
    if (!hasPermission) {
      return ctx.json(new ErrorResponse("cannot_delete_project").toJSON(), 404);
    }
    await db`DELETE FROM projects WHERE id = ${projectId}`;
    return ctx.json(new OkResponse().toJSON());
  }
  static async renameProject(ctx) {
    const projectId = ctx.req.param("projectId");
    if (!projectId) {
      return ctx.json(new ErrorResponse("project_id_not_found").toJSON(), 404);
    }
    const body = await ctx.req.json();
    const data = validateData(RenameProjectRequestSchema, body);
    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }
    const user2 = ctx.get("user");
    if (!user2) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const project = await DatabaseManager.getInstance(
      ctx
    )`SELECT id, team_id FROM projects WHERE id = ${projectId}`;
    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const team = await DatabaseManager.getInstance(
      ctx
    )`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`;
    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }
    const hasPermission = await _ProjectsController._hasAdminPermission(
      ctx,
      team[0]
    );
    if (!hasPermission) {
      return ctx.json(new ErrorResponse("cannot_rename_project").toJSON(), 403);
    }
    const updated = await DatabaseManager.getInstance(
      ctx
    )`UPDATE projects SET name = ${data.name} WHERE id = ${projectId} RETURNING id, name`;
    if (updated.length === 0) {
      return ctx.json(new ErrorResponse("project_not_updated").toJSON(), 400);
    }
    return ctx.json(new OkResponse().toJSON());
  }
  static async getProjectEvents(ctx) {
    const slug = ctx.req.param("slug");
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const project = await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.team_id as team_id,
        projects.slug as slug
      FROM projects
      WHERE projects.slug = ${slug}`;
    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const hasPermission = await _ProjectsController._hasPermission(
      ctx,
      project[0].team_id
    );
    if (!hasPermission) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const { rows } = await TursoDatabaseManager.getInstance(ctx).execute({
      sql: "SELECT id, session_id, project_id, name, data, created_at FROM events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 200",
      args: [project[0].id]
    });
    return ctx.json(rows);
  }
  static async getProjectBySlug(ctx) {
    const slug = ctx.req.param("slug");
    const query = ctx.req.query(
      "duration"
    );
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const project = await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.name as name,
        projects.team_id as team_id,
        projects.slug as slug,
        project_api_keys.key as api_key
      FROM projects
      LEFT JOIN project_api_keys
      ON projects.id = project_api_keys.project_id
      WHERE projects.slug = ${slug}`;
    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const hasPermission = await _ProjectsController._hasPermission(
      ctx,
      project[0].team_id
    );
    if (!hasPermission) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    let preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-3 months') AND datetime('now') AND project_id = ?";
    if (query) {
      switch (query) {
        case "24-hours":
          preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-24 hours') AND datetime('now') AND project_id = ?";
          break;
        case "seven-days":
          preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-7 days') AND datetime('now') AND project_id = ?";
          break;
        case "two-weeks":
          preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-14 days') AND datetime('now') AND project_id = ?";
          break;
        case "one-month":
          preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-1 month') AND datetime('now') AND project_id = ?";
          break;
        case "one-year":
          preparedStatement = "SELECT * FROM sessions WHERE created_at BETWEEN datetime('now', '-12 months') AND datetime('now') AND project_id = ?";
          break;
      }
    }
    const { rows } = await TursoDatabaseManager.getInstance(ctx).execute({
      sql: preparedStatement,
      args: [project[0].id]
    });
    const sessionResults = rows;
    const desktop = sessionResults.filter(
      ({ is_mobile }) => is_mobile === 0
    ).length;
    const mobile = sessionResults.filter(
      ({ is_mobile }) => is_mobile === 1
    ).length;
    return ctx.json(
      new ProjectDetailedResponse(project[0], {
        summary: groupSessionsByDateAndPlatform(sessionResults, query),
        device: {
          desktop,
          mobile
        },
        browserStats: Object.fromEntries(groupByBrowsers(sessionResults)),
        osStats: Object.fromEntries(groupByOs(sessionResults)),
        countryStats: Object.fromEntries(groupByCountry(sessionResults))
      }).toJSON()
    );
  }
  static async _hasPermission(ctx, teamId) {
    const user2 = ctx.get("user");
    if (!user2) {
      return false;
    }
    const team = await DatabaseManager.getInstance(
      ctx
    )`SELECT owner_id, id FROM teams WHERE id = ${teamId}`;
    if (team.length === 0) {
      return false;
    }
    if (user2.id === team[0].owner_id) {
      return true;
    }
    const teamMember = await DatabaseManager.getInstance(
      ctx
    )`SELECT id FROM team_members WHERE user_id = ${user2.id} AND team_id = ${team[0].id}`;
    if (teamMember.length === 0) {
      return false;
    }
    return true;
  }
  static async _hasAdminPermission(ctx, team) {
    const user2 = ctx.get("user");
    if (!user2) {
      return false;
    }
    if (user2.id === team.owner_id) {
      return true;
    }
    const teamMember = await DatabaseManager.getInstance(
      ctx
    )`SELECT permission_id FROM team_members WHERE user_id = ${user2.id} AND team_id = ${team.id}`;
    if (teamMember.length === 0) {
      return false;
    }
    if (teamMember[0].permission_id === TeamMemberPermissions2.ADMIN) {
      return true;
    }
    return false;
  }
};

// src/routers/ProjectsRouter.ts
var router3 = new Hono3();
router3.use(AuthenticationMiddleware);
router3.get("/:slug", ProjectsController.getProjectBySlug);
router3.get("/:slug/events", ProjectsController.getProjectEvents);
router3.post(
  "/:teamId",
  RequireVerifiedEmailMiddleware,
  ProjectsController.createProject
);
router3.patch("/:projectId", ProjectsController.renameProject);
router3.delete("/:projectId", ProjectsController.deleteProject);

// src/routers/Router.ts
var router4 = new Hono4();
router4.get("/config", async (ctx) => {
  const env2 = ctx.env;
  const config = resolvePrismConfig(env2);
  let setupRequired = false;
  if (config.deploymentMode === "self-hosted") {
    try {
      const db = DatabaseManager.getInstance(ctx);
      const rows = await db`SELECT id FROM "user" LIMIT 1`;
      setupRequired = rows.length === 0;
    } catch {
      setupRequired = true;
    }
  }
  return ctx.json({
    deploymentMode: config.deploymentMode,
    instanceName: config.instanceName,
    signupPolicy: config.signupPolicy,
    baseUrl: config.baseUrl,
    setupRequired,
    providers: {
      github: Boolean(env2.GITHUB_CLIENT_ID && env2.GITHUB_CLIENT_SECRET),
      google: Boolean(env2.GOOGLE_CLIENT_ID && env2.GOOGLE_CLIENT_SECRET)
    },
    mailConfigured: isMailConfigured(env2),
    // Whether the first-owner setup endpoint demands the setup token
    // (production self-hosted instances always do; local dev may not).
    setupTokenRequired: Boolean(env2.SETUP_TOKEN)
  });
});
router4.post("/setup/owner", SetupController.createOwner);
router4.route("/user", router);
router4.route("/teams", router2);
router4.route("/projects", router3);

// src/Server.ts
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";

// src/utils/cors.ts
var DEV_LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function resolveAllowedOrigins(env2) {
  return [
    ...new Set(
      [
        env2.CLIENT_URL,
        ...(env2.CORS_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
      ].filter((entry) => Boolean(entry))
    )
  ];
}
function isOriginAllowed(origin, env2) {
  if (resolveAllowedOrigins(env2).includes(origin)) {
    return true;
  }
  return resolveEnvironment(env2) === "development" && DEV_LOCALHOST_ORIGIN.test(origin);
}

// src/Server.ts
var authRateLimiter = new RateLimiter(6e4, 20);
var authRateLimit = createMiddleware3(async (ctx, next) => {
  const { allowed, retryAfterSeconds } = authRateLimiter.hit(clientIpFrom(ctx));
  if (!allowed) {
    ctx.header("Retry-After", String(retryAfterSeconds));
    return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
  }
  await next();
});
var Server = class {
  constructor() {
    this.started = false;
    this.instance = new OpenAPIHono();
  }
  startServer() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.instance.get("/", async (ctx) => {
      return ctx.text("Waguan");
    });
    this.instance.get("/health/live", (ctx) => {
      return ctx.json({ status: "ok" });
    });
    this.instance.get("/health/ready", async (ctx) => {
      try {
        const db = DatabaseManager.getInstance(ctx);
        await db`SELECT 1`;
        return ctx.json({ status: "ready" });
      } catch {
        return ctx.json({ status: "not_ready" }, 503);
      }
    });
    this.instance.get("/files/*", async (ctx) => {
      const key = ctx.req.path.replace(/^\/files\//, "");
      if (!key || key.includes("\\")) {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
      const full = await StorageManager.localFilePath(ctx, key);
      if (!full) {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
      const { readFile } = await import("node:fs/promises");
      const { extname } = await import("node:path");
      const contentTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".avif": "image/avif"
      };
      try {
        const data = await readFile(full);
        return new Response(data, {
          headers: {
            "content-type": contentTypes[extname(key).toLowerCase()] ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable"
          }
        });
      } catch {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
    });
    this.instance.use(
      "/api/auth/*",
      cors({
        origin: (origin, c) => {
          if (!origin) {
            return "*";
          }
          if (isOriginAllowed(origin, c.env)) {
            return origin;
          }
          return null;
        },
        credentials: true,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 86400
      })
    );
    this.instance.use("/api/auth/*", authRateLimit);
    this.instance.get("/api/auth/providers", (ctx) => {
      const env2 = ctx.env;
      return ctx.json({
        github: Boolean(env2.GITHUB_CLIENT_ID && env2.GITHUB_CLIENT_SECRET),
        google: Boolean(env2.GOOGLE_CLIENT_ID && env2.GOOGLE_CLIENT_SECRET)
      });
    });
    this.instance.all("/api/auth/*", (ctx) => {
      setEmailExecutor((promise) => ctx.executionCtx.waitUntil(promise));
      const auth = getAuth(ctx.env);
      return auth.handler(ctx.req.raw);
    });
    this.instance.use(
      "/api/v1/*",
      cors({
        origin: (origin, c) => {
          const env2 = c.env;
          const allowed = [
            env2.CLIENT_URL,
            ...(env2.CORS_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
          ].filter(Boolean);
          if (!origin) {
            return "*";
          }
          if (allowed.includes(origin)) {
            return origin;
          }
          return null;
        },
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 86400,
        credentials: true
      })
    );
    this.instance.route("/api/v1", router4);
    this.instance.get("/api/v1/docs", swaggerUI({ url: "/doc" }));
    this.instance.doc("/doc", {
      info: {
        title: "Prism API",
        version: "v1"
      },
      openapi: "3.1.0"
    });
  }
  getInstance() {
    return this.instance;
  }
};
var Server_default = new Server();

// src/index.node.ts
loadDotenv();
setRuntimeAdapter({ createProductDb: createPostgresProductDb });
var env = process.env;
var problems = validatePrismConfig(env);
if (problems.length > 0) {
  console.error(
    ["[prism-api] Configuration is invalid:", ...problems.map((p) => `  - ${p}`)].join(
      "\n"
    )
  );
  process.exit(1);
}
Server_default.startServer();
var port = Number.parseInt(env.PORT ?? "8787", 10);
serve({
  fetch: (request) => Server_default.getInstance().fetch(
    request,
    env,
    // Structural shim for the Worker ExecutionContext (runtime.ts seam).
    {
      waitUntil: () => void 0,
      passThroughOnException: () => void 0
    }
  ),
  port
});
console.log(`[prism-api] Node server listening on http://localhost:${port}`);

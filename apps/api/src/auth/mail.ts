/**
 * Provider-neutral mail interface for the auth module (task-6 section 3).
 *
 * Adapter precedence:
 * - MAIL_SMTP_HOST set: SMTP via nodemailer (self-hosted default).
 * - RESEND_API_KEY set: Resend (hosted default).
 * - Otherwise: development console adapter (prints the actionable link to
 *   the server log, never sends); production warns without printing
 *   recipients or links.
 *
 * Email delivery is never awaited on the response path by Better Auth
 * callbacks; the Worker runtime schedules these as background tasks.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import {
  generateConfirmEmailTemplate,
  generateResetPasswordTemplate,
} from "../utils/generateEmailTemplates";

type MailMessage =
  | {
      to: string;
      subject: string;
      template: "confirm-email";
      props: { name: string; confirmEmailLink: string };
    }
  | {
      to: string;
      subject: string;
      template: "reset-password";
      props: { name: string; resetLink: string };
    };

type EmailExecutor = (promise: Promise<unknown>) => void;

let executor: EmailExecutor | null = null;

/**
 * Registers the runtime's background-task primitive (Worker: ctx.waitUntil).
 * Without it (Node tests, self-hosted), delivery still runs, just awaited by
 * the caller of scheduleEmail when provided.
 */
export function setEmailExecutor(fn: EmailExecutor | null) {
  executor = fn;
}

/**
 * Schedules email delivery without blocking the response path. On the
 * Worker the promise is kept alive via ctx.waitUntil; elsewhere it runs
 * fire-and-forget with error containment.
 */
export function scheduleEmail(
  env: Record<string, string | undefined>,
  message: MailMessage,
) {
  const promise = dispatchEmail(env, message).catch((error) => {
    console.warn(
      "[prism-auth][mail] delivery failed:",
      error instanceof Error ? error.message : error,
    );
  });
  if (executor) {
    executor(promise);
  }
}

export async function dispatchEmail(
  env: Record<string, string | undefined>,
  message: MailMessage,
): Promise<void> {
  let html = "";
  switch (message.template) {
    case "confirm-email":
      html = generateConfirmEmailTemplate(message.props);
      break;
    case "reset-password":
      html = generateResetPasswordTemplate(message.props);
      break;
  }

  if (env.MAIL_SMTP_HOST) {
    // SMTP adapter (self-hosted): credentials are optional for local
    // relays; MAIL_FROM defaults to a clearly local address.
    const transporter = nodemailer.createTransport({
      host: env.MAIL_SMTP_HOST,
      port: Number.parseInt(env.MAIL_SMTP_PORT ?? "587", 10),
      secure: env.MAIL_SMTP_SECURE === "true",
      auth:
        env.MAIL_SMTP_USER && env.MAIL_SMTP_PASS
          ? { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASS }
          : undefined,
    });
    await transporter.sendMail({
      from: env.MAIL_FROM ?? "Prism <no-reply@localhost>",
      to: message.to,
      subject: message.subject,
      html,
    });
    return;
  }

  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    if (env.ENVIRONMENT !== "development") {
      console.warn(
        "[prism-auth][mail] delivery skipped: no production mail provider is configured. " +
          "Set MAIL_SMTP_HOST (SMTP) or RESEND_API_KEY (Resend).",
      );
      return;
    }

    // Development console adapter: print the actionable link only.
    const link =
      message.template === "confirm-email"
        ? message.props.confirmEmailLink
        : message.props.resetLink;
    console.log(
      `[prism-auth][mail:${message.template}] To: ${message.to} — ${link}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "Prism <onboarding@resend.dev>",
    to: [message.to],
    subject: message.subject,
    html,
  });

  if (error) {
    console.warn(
      `[prism-auth][mail:${message.template}] delivery failed: ${error.message}`,
    );
  }
}

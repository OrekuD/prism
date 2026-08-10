/**
 * Provider-neutral mail interface for the auth module.
 *
 * - Hosted/local with RESEND_API_KEY set: delivers via Resend.
 * - Development without Resend: logs the email to the server console.
 * - Production without Resend: reports missing mail configuration without
 *   printing the recipient or the actionable verification/reset link.
 *
 * Email delivery is never awaited on the response path by Better Auth
 * callbacks; the Worker runtime schedules these as background tasks.
 */
import { Resend } from "resend";
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

  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    if (env.ENVIRONMENT !== "development") {
      console.warn(
        "[prism-auth][mail] delivery skipped: no production mail provider is configured",
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

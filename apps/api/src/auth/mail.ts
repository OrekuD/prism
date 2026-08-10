/**
 * Provider-neutral mail interface for the auth module.
 *
 * - Hosted/local with RESEND_API_KEY set: delivers via Resend.
 * - Self-hosted without Resend: logs the email to the server console
 *   (development console adapter) — no external dependency required.
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

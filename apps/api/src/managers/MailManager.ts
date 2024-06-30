import { Context } from "hono";
import { HonoConfig, MailProps } from "../types/types";
import { Resend } from "resend";
import {
  generateConfirmEmailTemplate,
  generateMagicLinkTemplate,
  generateNewEmailTemplate,
  generateOTPSignInTemplate,
  generateResetPasswordTemplate,
  generateWelcomeTemplate,
} from "../utils/generateEmailTemplates";

export default class MailManager {
  private static resend: Resend;

  public static async dispatch(
    ctx: Context<HonoConfig>,
    mail: MailProps,
    recipientEmail: string,
  ) {
    if (!this.resend) {
      this.resend = new Resend(ctx.env.RESEND_API_KEY);
    }

    let html = "";
    let subject = "";
    switch (mail.name) {
      case "welcome":
        subject = "Welcome to Prism!";
        html = generateWelcomeTemplate(mail.props);
        break;

      case "reset-password":
        subject = "Password Reset Request for Your Prism Account";
        html = generateResetPasswordTemplate(mail.props);
        break;

      case "confirm-email":
        subject = "Confirm Email for your Prism Account";
        html = generateConfirmEmailTemplate(mail.props);
        break;

      case "magic-link":
        subject = "Log in with this magic link";
        html = generateMagicLinkTemplate(mail.props);
        break;

      case "otp-sign-in":
        subject = "Your login code for Prism";
        html = generateOTPSignInTemplate(mail.props);
        break;

      case "new-email":
        subject = "Verify Your New Email Address for Your Prism Account";
        html = generateNewEmailTemplate(mail.props);
        break;
    }

    const { error, data } = await this.resend.emails.send({
      from: "Prism <onboarding@resend.dev>",
      to: [recipientEmail],
      subject,
      html,
    });

    if (data?.id) {
      console.log(`-------${mail.name} - Mail sent`);
    }

    if (error !== null) {
      console.log({ error });
      // return ctx.json(new ErrorResponse('email_dispatch_error'), 400);
    }
  }
}

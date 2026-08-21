import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailHeader } from "./email-header";

interface WelcomeEmailProps {
  /** Deployment identity shown next to the mark. */
  instanceName?: string;
  name: string;
  confirmEmailLink: string;
}

export const WelcomeEmail = ({ instanceName,
  name: userFirstname,
  confirmEmailLink: resetPasswordLink,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <EmailHeader instanceName={instanceName} />
          
          <Section>
            <Text style={text}>Hi {userFirstname},</Text>
            <Text style={text}>
              Thank you for signing up for Prism! To complete your registration
              and activate your account, please confirm your email address by
              clicking the link below:
            </Text>
            <Button style={button} href={resetPasswordLink}>
              Confirm email
            </Button>
            <Text style={text}>
              For security reasons, this link will expire in 48 hours.
            </Text>
            <Text style={text}>We’re excited to have you with us.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

WelcomeEmail.PreviewProps = {
  name: "David",
  confirmEmailLink: "https://Prism.com",
} as WelcomeEmailProps;

const main = {
  backgroundColor: "#f6f9fc",
  padding: "10px 0",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #f0f0f0",
  padding: "45px",
  borderRadius: "6px",
};

const text = {
  fontSize: "16px",
  fontFamily:
    "'Open Sans', 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif",
  fontWeight: "300",
  color: "#404040",
  lineHeight: "26px",
};

const button = {
  backgroundColor: "#000000",
  borderRadius: "4px",
  color: "#fff",
  fontFamily: "'Open Sans', 'Helvetica Neue', Arial",
  fontSize: "15px",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  width: "210px",
  padding: "14px 7px",
};

const anchor = {
  textDecoration: "underline",
};

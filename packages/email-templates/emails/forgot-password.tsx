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

interface ForgotPasswordProps {
  /** Deployment identity shown next to the mark. */
  instanceName?: string;
  name: string;
  resetPasswordLink: string;
}

export const ForgotPassword = ({ instanceName,
  name,
  resetPasswordLink,
}: ForgotPasswordProps) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <EmailHeader instanceName={instanceName} />
          
          <Section>
            <Text style={text}>Hi {name},</Text>
            <Text style={text}>
              We received a request to reset your password for your Prism
              account. If you did not make this request, you can ignore this
              email. Otherwise, please follow the instructions below to reset
              your password.
            </Text>
            <Text style={text}>
              Click the link below to reset your password:
            </Text>
            <Button style={button} href={resetPasswordLink}>
              Reset password
            </Button>
            <Text style={text}>
              For security reasons, this link will expire in 24 hours. If the
              link has expired, you will need to request a new password reset.
            </Text>
            <Text style={text}>Thank you for using Prism.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

ForgotPassword.PreviewProps = {
  name: "David",
  resetPasswordLink: "https://Prism.com",
} as ForgotPasswordProps;

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

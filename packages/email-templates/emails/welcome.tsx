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

interface WelcomeEmailProps {
  name: string;
  confirmEmailLink: string;
}

export const WelcomeEmail = ({
  name: userFirstname,
  confirmEmailLink: resetPasswordLink,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Img
            src={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='14' viewBox='0 0 60 14'%3E%3Crect width='6' height='6' fill='%236547e8'/%3E%3Ctext x='10' y='11' font-family='monospace' font-size='11' font-weight='600' fill='%23111116'%3EPrism%3C/text%3E%3C/svg%3E`}
            height="26"
            alt="Prism logo"
          />
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

export WelcomeEmail;

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

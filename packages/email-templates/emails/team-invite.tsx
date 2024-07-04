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
  confirmEmailLink: teamInviteUrl,
}: WelcomeEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Img
            src={`https://res.cloudinary.com/orekud/image/upload/v1716760242/Prism-assets/logo_black_spianu.png`}
            height="26"
            alt="Prism logo"
          />
          <Section>
            <Text style={text}>
              You've Been Invited to Join TEAM_NAME on Prism
            </Text>
            <Button style={button} href={teamInviteUrl}>
              Accept
            </Button>
            <Text style={text}>Thank you for using Prism.</Text>
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

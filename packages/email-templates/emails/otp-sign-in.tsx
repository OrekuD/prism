import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface OTPSignInProps {
  code: string;
}

export const OTPSignIn = ({ code }: OTPSignInProps) => {
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
            <Text style={text}>Enter the following code to sign in</Text>
            <Section style={codeContainer}>
              <Text style={codeStyle}>{code}111</Text>
            </Section>
            <Text style={text}>
              For security reasons, this code will expire in 10 minutes. If the
              link has expired, you will need to request a new one.
            </Text>
            <Text style={text}>Thank you for using Prism.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

OTPSignIn.PreviewProps = {
  code: "123456",
  signInLink: "https://Prism.com",
} as OTPSignInProps;

export OTPSignIn;

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

const codeContainer = {
  background: "rgba(0,0,0,.05)",
  borderRadius: "4px",
  margin: "16px 0",
  verticalAlign: "middle",
  width: "280px",
};

const codeStyle = {
  color: "#000",
  display: "inline-block",
  fontFamily: "HelveticaNeue-Bold",
  fontSize: "32px",
  fontWeight: 700,
  letterSpacing: "6px",
  lineHeight: "40px",
  paddingBottom: "8px",
  paddingTop: "8px",
  margin: "0 auto",
  width: "100%",
  textAlign: "center" as const,
};

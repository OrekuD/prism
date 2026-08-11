import { Img, Text } from "@react-email/components";
import * as React from "react";
import { PRISM_EMAIL_LOGO_PNG } from "./logo-png";

/**
 * Shared Prism email header (task-7 section 8): the canonical square mark
 * as an embedded base64 PNG (works in Outlook/Gmail/Apple Mail; no remote
 * fetch, so self-hosted mail never depends on an external host) plus the
 * deployment identity as text. When images are blocked the instance name
 * text still identifies the sender.
 */
export function EmailHeader({ instanceName }: { instanceName?: string }) {
  const label = instanceName?.trim() || "Prism";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 24,
      }}
    >
      <Img
        src={PRISM_EMAIL_LOGO_PNG}
        width="24"
        height="24"
        alt=""
        aria-hidden={true}
      />
      <Text
        style={{
          margin: 0,
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 14,
          fontWeight: 600,
          color: "#111116",
          letterSpacing: "-0.02em",
        }}
      >
        {label}
      </Text>
    </div>
  );
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchEmail } from "../auth/mail";
import { resetTransport, setTransport, type LogLevel } from "../utils/logger";

describe("auth mail security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetTransport();
  });

  it("never logs an actionable auth link when production mail is unconfigured", async () => {
    const lines: string[] = [];
    const levels: LogLevel[] = [];
    setTransport((level, line) => {
      levels.push(level);
      lines.push(line);
    });
    const sensitiveLink =
      "https://prism.example/api/auth/verify-email?token=sensitive-token";

    await dispatchEmail(
      { ENVIRONMENT: "production" },
      {
        to: "owner@example.com",
        subject: "Confirm your account",
        template: "confirm-email",
        props: { name: "Owner", confirmEmailLink: sensitiveLink },
      },
    );

    // The structured logger replaced console.* — capture its output.
    const output = lines.join("\n");
    expect(levels).toContain("warn");
    expect(output).toContain("no production mail provider is configured");
    expect(output).not.toContain("sensitive-token");
    expect(output).not.toContain("owner@example.com");
    expect(output).not.toContain("https://prism.example");
  });
});

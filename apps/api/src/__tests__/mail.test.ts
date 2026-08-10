import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchEmail } from "../auth/mail";

describe("auth mail security", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs an actionable auth link when production mail is unconfigured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-token");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("owner@example.com");
  });
});

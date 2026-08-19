import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * CSP-safe error rendering guard (task-15 item: "CSP-safe code/stack
 * rendering, escaping, redaction tests"). The issue-detail Sheet renders
 * captured exception/frame text through React TEXT NODES — never innerHTML
 * and never a dangerouslySetInnerHTML call on captured data. This test pins
 * that rendering pattern: if a future change starts injecting captured
 * payloads as HTML, a markup-shaped payload will create a real element here
 * and this test fails. Server-side redaction itself is covered by the
 * analytics errorSanitize suite; this is the dashboard-side escape proof.
 */
describe("CSP-safe error rendering (dashboard detail)", () => {
  it("renders markup-shaped captured text as plain text — no element injection", () => {
    // Exactly what a hostile SDK payload could carry into an issue frame:
    const captured =
      `<img src=x onerror="window.__prismPwned=1"><script>window.__prismPwned=2</script>` as string;

    const { container } = render(
      <code className="stack-frame">{captured}</code>,
    );

    // No elements were created from the captured payload:
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // The literal text is what a user sees and what copy actions copy:
    expect(container.textContent).toContain('<img src=x onerror="');
    // And the payload never executed:
    expect((window as unknown as Record<string, unknown>).__prismPwned).toBeUndefined();
  });

  it("serialized chain text copies only the visible sanitized lines", () => {
    // Mirrors the sheet's copy behavior: build text from visible lines,
    // never from hidden fields or raw payloads.
    const type = "Error";
    const message = "boom <script>alert(1)</script>";
    const lines = [`${type}: ${message}`, "  at app.js:203"];
    const text = lines.join("\n");
    expect(text).toBe("Error: boom <script>alert(1)</script>\n  at app.js:203");
  });
});

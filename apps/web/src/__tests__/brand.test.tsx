import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrismMark } from "@/components/brand/prism-mark";
import { PrismLogo } from "@/components/brand/prism-logo";

/**
 * Task-7 section 4 (updated for the prism-logo.png asset): square sizing,
 * accessible naming, and decorative use of the shared logo components.
 */

describe("PrismMark", () => {
  it("renders a square logo image with equal width and height", () => {
    const { container } = render(<PrismMark size={32} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/prism-logo.png");
    expect(img?.getAttribute("width")).toBe("32");
    expect(img?.getAttribute("height")).toBe("32");
    expect(img?.style.aspectRatio).toBe("1 / 1");
  });

  it("exposes the variant attribute for drift tests", () => {
    const { container } = render(<PrismMark variant="dark" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("data-variant")).toBe("dark");
  });

  it("is a labelled image by default", () => {
    render(<PrismMark />);
    expect(screen.getByRole("img", { name: "Prism" })).toBeDefined();
  });

  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<PrismMark decorative />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.hasAttribute("role")).toBe(false);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("PrismLogo", () => {
  it("composes the square mark with the wordmark", () => {
    const { container } = render(<PrismLogo />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("width")).toBe(img?.getAttribute("height"));
    expect(container.textContent).toContain("Prism");
    // The mark itself is decorative inside the lockup (text names it).
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is hidden entirely when decorative", () => {
    const { container } = render(<PrismLogo decorative />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrismMark } from "@/components/brand/prism-mark";
import { PrismLogo } from "@/components/brand/prism-logo";

/**
 * Task-7 section 4: square sizing, variants, accessible naming, and
 * decorative use of the shared logo components.
 */

describe("PrismMark", () => {
  it("renders a square SVG with equal width and height", () => {
    const { container } = render(<PrismMark size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.style.aspectRatio).toBe("1 / 1");
  });

  it("applies variant fills and exposes them for drift tests", () => {
    const { container } = render(<PrismMark variant="dark" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-variant")).toBe("dark");
    const paths = container.querySelectorAll("path");
    expect(paths[0]?.getAttribute("fill")).toBe("#F2F2F4");
    expect(paths[1]?.getAttribute("fill")).toBe("#6547E8");
  });

  it("uses the canonical master geometry paths", () => {
    const { container } = render(<PrismMark />);
    const paths = container.querySelectorAll("path");
    expect(paths[0]?.getAttribute("d")).toContain("M 2.97 14.56");
    expect(paths[1]?.getAttribute("d")).toContain("M 3.53 15.74");
  });

  it("is a labelled image by default", () => {
    render(<PrismMark />);
    expect(screen.getByRole("img", { name: "Prism" })).toBeDefined();
  });

  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<PrismMark decorative />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("role")).toBe(false);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("PrismLogo", () => {
  it("composes the square mark with the wordmark", () => {
    const { container } = render(<PrismLogo />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe(svg?.getAttribute("height"));
    expect(container.textContent).toContain("Prism");
    // The mark itself is decorative inside the lockup (text names it).
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is hidden entirely when decorative", () => {
    const { container } = render(<PrismLogo decorative />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Index } from "@/routes/index";

describe("public landing", () => {
  it("leads with the current product instead of the onboarding preview", () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Know what changed. Understand what matters.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: /current prism web analytics/i }),
    ).toHaveAttribute("src", "/web-analytics-current.webp");
    expect(screen.queryByAltText(/onboarding dashboard/i)).not.toBeInTheDocument();
  });

  it("keeps hosted, self-hosted, and documentation paths obvious", () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Start hosted" })).toHaveAttribute(
      "href",
      "/auth/create-account",
    );
    expect(screen.getByRole("link", { name: "Self-host Prism" })).toHaveAttribute(
      "href",
      expect.stringContaining("/docs/self-hosting/self-host-prism"),
    );
    expect(screen.getByRole("link", { name: "Read the quickstart" })).toHaveAttribute(
      "href",
      expect.stringContaining("/docs/start/quickstart"),
    );
  });

  it("shows an asymmetric feature story and a two-stage setup", () => {
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "A connected view of your product." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "See where traffic goes." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Trace each action." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Investigate errors in context." })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ask Prism what changed." })).toBeVisible();
    expect(screen.getByText("Web analytics")).toBeVisible();
    expect(screen.getByText("Error tracking")).toBeVisible();
    expect(screen.queryByText(/01 \/ Web analytics/)).not.toBeInTheDocument();
    expect(screen.queryByText("Measured facts ↗")).not.toBeInTheDocument();
    expect(document.querySelector(".landing-route-visual")).toBeNull();
    expect(screen.getByText("01 / Install")).toBeInTheDocument();
    expect(screen.getByText("02 / Implement")).toBeInTheDocument();
    expect(screen.queryByText(/Example key only/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/createBrowserClient/)).toHaveLength(2);
    expect(
      screen.getByLabelText("Browser SDK implementation example").querySelector(".twinkleplop .tok"),
    ).not.toBeNull();
  });
});

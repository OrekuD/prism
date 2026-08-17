import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * First-boot reachability (task-6 hardening): the anonymous OwnerSetup
 * branch must render on a fresh self-hosted instance (the /setup route)
 * and signed-out visitors must not be redirected before the runtime
 * config resolves.
 */

vi.mock("@/lib/authClient", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    signIn: { email: vi.fn() },
  },
  authBaseUrl: "http://localhost:8787",
  fetchEnabledProviders: async () => ({ github: false, google: false }),
}));

vi.mock("@/lib/runtimeConfig", () => ({
  loadRuntimeConfig: vi.fn(),
}));

vi.mock("@/lib/telemetry", () => ({
  TELEMETRY_EVENTS: { onboardingStep: "onboarding_step" },
  trackTelemetry: vi.fn(),
}));

vi.mock("@/network/queries/useProjectsQuery", () => ({
  useProjectsQuery: () => ({ data: null, isPending: true }),
}));

vi.mock("@/lib/workspace", () => ({
  useCurrentWorkspace: () => ({ workspace: null, isLoading: true }),
  useWorkspaces: () => ({ data: [], isPending: true }),
  useActiveWorkspace: () => ({ data: null, isPending: true }),
  useActiveMember: () => ({ data: null }),
  WORKSPACE_PLATFORMS: ["web", "ios", "android", "react-native", "server"],
}));

vi.mock("@/lib/session", () => ({
  waitForSession: async () => true,
}));

import { loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtimeConfig";
import { Onboarding } from "@/routes/onboarding";

const SELF_HOSTED_FIRST_BOOT = {
  deploymentMode: "self-hosted",
  instanceName: "Scratch Prism",
  signupPolicy: "disabled",
  baseUrl: "http://localhost:8787",
  setupRequired: true,
  setupTokenRequired: true,
  providers: { github: false, google: false },
  mailConfigured: false,
} as const;

const HOSTED = {
  deploymentMode: "hosted",
  instanceName: "Prism",
  signupPolicy: "open",
  baseUrl: "http://localhost:8787",
  setupRequired: false,
  setupTokenRequired: false,
  providers: { github: false, google: false },
  mailConfigured: false,
} as const;

function renderPage(initialPath = "/setup") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Onboarding />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("first boot (/setup)", () => {
  it("renders the owner setup with the token field on a fresh self-hosted instance", async () => {
    vi.mocked(loadRuntimeConfig).mockResolvedValue(SELF_HOSTED_FIRST_BOOT);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Create the owner account" }),
    ).toBeDefined();
    // The token field appears once the OwnerSetup's own config fetch lands.
    expect(await screen.findByLabelText("Setup token")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeDefined();
  });

  it("does not redirect signed-out visitors while the config loads", async () => {
    let resolveConfig: (value: RuntimeConfig) => void = () => undefined;
    vi.mocked(loadRuntimeConfig).mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    renderPage();

    // Before the config resolves there is no redirect and no crash.
    expect(screen.queryByText("Sign in to your account")).toBeNull();
    expect(document.body.textContent).not.toContain("PAGE NOT FOUND");
    resolveConfig(SELF_HOSTED_FIRST_BOOT);
    expect(
      await screen.findByRole("heading", { name: "Create the owner account" }),
    ).toBeDefined();
  });

  it("redirects to sign-in on a hosted instance", async () => {
    vi.mocked(loadRuntimeConfig).mockResolvedValue(HOSTED);
    renderPage();

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Create the owner account" }),
      ).toBeNull();
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LogIn } from "@/routes/auth/log-in";
import { Index } from "@/routes/index";
import axe from "axe-core";
import { CreateAccount } from "@/routes/auth/create-account";
import { ForgotPassword } from "@/routes/auth/forgot-password";
import { Toaster } from "@/components/ui/sonner";
import { PublicLayout } from "@/components/layout/public-layout";

const signInEmail = vi.fn();
const signUpEmail = vi.fn();
const signInSocial = vi.fn();
const requestPasswordReset = vi.fn();
const listOrganizations = vi.fn();
const organizationUpdate = vi.fn();
let sessionVisible = true;

vi.mock("@/lib/authClient", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    useListOrganizations: () => ({ data: [], isPending: false }),
    useActiveOrganization: () => ({ data: null, isPending: false }),
    // waitForSession() reads the session atom and falls back to
    // getSession(); both report a session so post-auth navigation
    // resolves immediately in tests.
    $store: {
      atoms: {
        session: {
          get: () => ({
            data: sessionVisible ? { session: { id: "test-session" } } : null,
            isPending: false,
          }),
        },
      },
    },
    getSession: async () => {
      sessionVisible = true;
      return { data: { session: { id: "test-session" } }, error: null };
    },
    organization: {
      list: () => listOrganizations(sessionVisible),
      update: (...args: unknown[]) => organizationUpdate(...args),
    },
    signIn: {
      email: (...args: unknown[]) => signInEmail(...args),
      social: (...args: unknown[]) => signInSocial(...args),
    },
    signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  },
  authBaseUrl: "http://localhost:8787",
  fetchEnabledProviders: async () => ({ github: false, google: false }),
  resendVerificationEmail: async () => undefined,
}));

vi.mock("@/lib/runtimeConfig", () => ({
  loadRuntimeConfig: async () => ({
    deploymentMode: "hosted",
    instanceName: "Prism",
    signupPolicy: "open",
    baseUrl: "http://localhost:8787",
    setupRequired: false,
    providers: { github: false, google: false },
    mailConfigured: false,
  }),
}));

function renderPage(page: React.ReactNode, initialPath = "/auth/log-in") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      {page}
      <Toaster />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionVisible = true;
  organizationUpdate.mockResolvedValue({ data: null, error: null });
  listOrganizations.mockImplementation((hasSession: boolean) => ({
    data: hasSession ? [{ id: "workspace-1", slug: "workspace-one" }] : null,
    error: hasSession ? null : { status: 401 },
  }));
});

describe("auth failure states", () => {
  it("keeps login focused and provider buttons presentation-only", async () => {
    renderPage(<PublicLayout><LogIn /></PublicLayout>);
    expect(screen.getByRole("heading", { name: "Sign in to Prism" })).toBeVisible();
    expect(screen.queryByText("Instance")).toBeNull();
    expect(screen.queryByText("localhost:8787")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/auth/forgot-password");
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toHaveClass("rounded-full", "bg-accent", "h-10");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.getByRole("status")).toHaveTextContent("Google sign-in isn't available yet");
    await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(screen.getByRole("status")).toHaveTextContent("GitHub sign-in isn't available yet");
    expect(signInSocial).not.toHaveBeenCalled();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("shows the OAuth denied state from ?error=access_denied", async () => {
    renderPage(<LogIn />, "/auth/log-in?error=access_denied");
    expect(
      await screen.findByText(/You denied access to your account/i),
    ).toBeInTheDocument();
  });

  it("shows the account-not-linked state from ?error=account_not_linked", async () => {
    renderPage(<CreateAccount />, "/auth/create-account?error=account_not_linked");
    expect(
      await screen.findByText(/not linked to a Prism account/i),
    ).toBeInTheDocument();
  });

  it("advances through email → password → details and submits", async () => {
    signUpEmail.mockResolvedValue({
      data: { user: { emailVerified: false } },
      error: null,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ available: true })));
    renderPage(<CreateAccount />);

    // Step 1: email only.
    await userEvent.type(
      screen.getByLabelText("Email"),
      "newuser@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Secure your account" }),
    ).toBeInTheDocument();

    // Step 2: password; the button enables once the requirement is met.
    const continueStep2 = screen.getByRole("button", { name: "Continue" });
    expect(continueStep2).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Password"), "hunter2222");
    expect(continueStep2).toBeEnabled();
    await userEvent.click(continueStep2);
    expect(
      screen.getByRole("heading", { name: "Tell us about yourself" }),
    ).toBeInTheDocument();

    // Step 3: name + workspace, then create.
    await userEvent.type(screen.getByLabelText("Your name"), "David");
    await userEvent.type(screen.getByLabelText("Workspace name"), "Oreku");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );
    // The chosen workspace name rides in-band; provisioning is
    // server-side — the client never renames.
    await waitFor(() => expect(signUpEmail).toHaveBeenCalledTimes(1));
    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newuser@example.com",
        name: "David",
        signupWorkspaceName: "Oreku",
      }),
    );
    expect(organizationUpdate).not.toHaveBeenCalled();    expect(signUpEmail.mock.calls[0][0].password).toBe("hunter2222");
    fetchSpy.mockRestore();
  });

  it("routes taken emails to sign-in at step 1", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ available: false })));
    renderPage(<CreateAccount />);

    await userEvent.type(
      screen.getByLabelText("Email"),
      "taken@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "You already have an account." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/taken@example.com/)).toBeInTheDocument();
    const signInLink = screen.getByRole("link", { name: "Sign in" });
    expect(signInLink).toHaveAttribute(
      "href",
      "/auth/log-in?email=taken%40example.com",
    );
    expect(signUpEmail).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("falls back to the account-exists hand-off when a duplicate races the probe", async () => {
    signUpEmail.mockResolvedValue({
      data: null,
      error: { status: 422, message: "User already exists" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ available: true })));
    renderPage(<CreateAccount />);

    await userEvent.type(
      screen.getByLabelText("Email"),
      "racer@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(screen.getByLabelText("Password"), "hunter2222");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(screen.getByLabelText("Your name"), "David");
    await userEvent.type(screen.getByLabelText("Workspace name"), "Oreku");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );

    expect(
      await screen.findByRole("heading", { name: "You already have an account." }),
    ).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("prefills the login email from ?email= hand-off", () => {
    renderPage(<LogIn />, "/auth/log-in?email=prefill@example.com");
    expect(
      screen.getByLabelText("Email"),
    ).toHaveValue("prefill@example.com");
  });

  it("records and shows the last-used sign-in method", async () => {
    // Password method: pill sits on the email label row.
    localStorage.setItem("prism.lastAuth:user@example.com", "password");
    const first = renderPage(<LogIn />);
    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    expect(screen.getByText("Last used")).toBeInTheDocument();
    first.unmount();

    // Social method: floating pill on the matching provider button.
    localStorage.setItem("prism.lastAuth:oauth@example.com", "google");
    renderPage(<LogIn />, "/auth/log-in?email=oauth@example.com");
    expect(await screen.findByText("Last used")).toBeInTheDocument();
  });

  it("reports a network failure instead of invalid credentials", async () => {
    signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage(<LogIn />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(/Cannot reach Prism/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invalid email or password/i)).not.toBeInTheDocument();
  });

  it("shows a non-enumerating error for bad credentials", async () => {
    signInEmail.mockResolvedValue({ error: { message: "Invalid email or password" } });
    renderPage(<LogIn />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(/Invalid email or password/i),
    ).toBeInTheDocument();
  });
});

describe("public surfaces axe scan", () => {
  it("landing page has no serious/critical violations", async () => {
    const { container } = renderPage(<Index />, "/");
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(serious).toEqual([]);
  });

  it("auth shell has no serious/critical violations", async () => {
    const { container } = renderPage(<LogIn />, "/auth/log-in");
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(serious).toEqual([]);
  });
});

describe("duplicate-submit prevention", () => {
  it("waits for the session before loading the default workspace", async () => {
    sessionVisible = false;
    signInEmail.mockResolvedValue({ data: null, error: null });
    renderPage(<LogIn />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(listOrganizations).toHaveBeenCalled());
    expect(listOrganizations).toHaveBeenCalledWith(true);
  });

  it("submits the sign-in form only once while pending", async () => {
    let resolveSignIn: ((value: unknown) => void) | undefined;
    signInEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    renderPage(<LogIn />);

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    const submit = screen.getByRole("button", { name: "Sign in" });

    await userEvent.type(email, "user@example.com");
    await userEvent.type(password, "password123");
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    // Enter while pending must not trigger a second request.
    await userEvent.keyboard("{Enter}");
    resolveSignIn?.({ data: null, error: null });
    await waitFor(() => expect(signInEmail).toHaveBeenCalledTimes(1));
    // The button stays in its loading state through navigation — it must not
    // reset to idle (and expose the form again) before the dashboard mounts.
    expect(submit).toBeDisabled();
    expect(signInEmail).toHaveBeenCalledTimes(1);
  });

  it("guards the forgot-password form against double submission", async () => {
    let resolveReset: ((value: unknown) => void) | undefined;
    requestPasswordReset.mockReturnValue(
      new Promise((resolve) => {
        resolveReset = resolve;
      }),
    );
    renderPage(<ForgotPassword />, "/auth/forgot-password");

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    const submit = screen.getByRole("button", { name: "Send reset link" });
    await userEvent.click(submit);
    await userEvent.keyboard("{Enter}");
    resolveReset?.({ data: null, error: null });
    await waitFor(() =>
      expect(screen.getByText(/the reset link is on its way/i)).toBeInTheDocument(),
    );
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  });
});

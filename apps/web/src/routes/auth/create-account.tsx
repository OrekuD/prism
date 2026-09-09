import { Check, Loader2 } from "@/components/ui/lucide-icons";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthShell, OrEmailDivider } from "@/components/auth/auth-shell";
import { isNetworkError, oauthErrorMessage } from "@/components/auth/auth-errors";
import { PasswordInput } from "@/components/auth/password-input";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { waitForSession } from "@/lib/session";
import { loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtimeConfig";
import { getLastAuthMethod } from "@/lib/lastAuth";
import { API_BASE_URL } from "@/lib/api";
import { TELEMETRY_EVENTS, trackTelemetry } from "@/lib/telemetry";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Signup duplicate probe — GET /api/v1/auth/email-available. Best-effort:
 * any failure (network, rate limit) returns "available" and lets the
 * authoritative signup submit handle a duplicate.
 */
async function checkEmailAvailable(email: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/auth/email-available?email=${encodeURIComponent(email)}`,
    );
    if (!response.ok) return true;
    const data = (await response.json()) as { available?: boolean };
    return data.available !== false;
  } catch {
    return true;
  }
}

type Step = 1 | 2 | 3;

/**
 * Create-account flow (redesign): three single-purpose steps —
 * email → password → name + workspace — following the email-first pattern.
 * Step transitions are directional fades (12px horizontal, 200ms) with the
 * whole card animated as one unit; reduced-motion users get the global
 * instant flatten. Duplicate emails route to sign-in: the availability
 * probe catches them at step 1, and a USER_ALREADY_EXISTS race at final
 * submit falls back to the private email flow (a reset link that only the
 * account owner receives).
 */
export function CreateAccount() {
  const [searchParams] = useSearchParams();
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  const [step, setStep] = React.useState<Step>(1);
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [emailTaken, setEmailTaken] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [providerNotice, setProviderNotice] = React.useState<string | null>(
    null,
  );
  const [config, setConfig] = React.useState<RuntimeConfig | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  // Move focus to the new step's heading after each transition.
  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step, emailTaken]);

  const goTo = (next: Step) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const registrationClosed =
    config?.signupPolicy === "disabled" || config?.signupPolicy === "invite-only";

  const selfHosted = config?.deploymentMode === "self-hosted";

  const onSubmitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setChecking(true);
    const available = await checkEmailAvailable(trimmed);
    setChecking(false);
    if (!available) {
      setEmailTaken(true);
      return;
    }
    goTo(2);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return; // duplicate-submit guard
    setError(null);
    setIsPending(true);
    try {
      // signupWorkspaceName is a server-side user additionalField the
      // client's generated types don't know about — typed at the API
      // (options.ts) and consumed by the user.create.after hook.
      const response = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
        signupWorkspaceName: workspaceName.trim(),
      } as Parameters<typeof authClient.signUp.email>[0]);
      if (response.error) {
        const message = response.error.message ?? "";
        const duplicate = response.error.status === 422 || /already exists/i.test(message);
        if (duplicate) {
          // Race between the step-1 probe and account creation: route to
          // the same "account exists" hand-off (direct disclosure per the
          // availability-probe design).
          setEmailTaken(true);
          setIsPending(false);
          return;
        }
        setError(
          isNetworkError(response.error)
            ? "Cannot reach Prism. Check your connection and try again."
            : (message || "Something went wrong. Try again."),
        );
        setIsPending(false);
        return;
      }
      trackTelemetry(TELEMETRY_EVENTS.signupMethod, { method: "email" });
      // Sign-up creates a session immediately, even with verification
      // pending. Hard-navigate after the session is durable so the fresh
      // boot reads the cookie and never bounces back to this page. The
      // workspace was provisioned server-side with the chosen name —
      // no client-side rename needed.
      await waitForSession();
      // Verified accounts continue into onboarding; unverified ones land
      // in the product shell, where the verification banner offers a resend.
      window.location.assign(
        response.data?.user?.emailVerified ? "/onboarding" : "/overview",
      );
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Something went wrong. Try again.",
      );
      setIsPending(false);
    }
  };

  const onSocial = async (provider: "github" | "google") => {
    // Presentation-only until the provider integrations land (same as log-in).
    setProviderNotice(
      `${provider === "github" ? "GitHub" : "Google"} sign-up isn't available yet. Please use email.`,
    );
  };

  if (registrationClosed && config) {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text">
            Registration is closed.
          </h1>
          <p className="mt-2 text-[13px] text-text-muted">
            {config.signupPolicy === "invite-only"
              ? `Accounts on ${config.instanceName} are created by invitation only.`
              : `New accounts on ${config.instanceName} are not being accepted right now.`}
          </p>
          <div className="mt-8 grid gap-5">
            <p className="text-[13px] leading-relaxed text-text-muted">
              {config.signupPolicy === "invite-only"
                ? "Use the invite link you received, or sign in if you already have an account."
                : "Sign in if you already have an account, or contact the instance operator."}
            </p>
            <Link
              to="/auth/log-in"
              className="inline-flex h-10 w-fit items-center justify-center self-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
            >
              Sign in
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const stepAnimation = `animate-in fade-in duration-200 ease-out ${
    direction === 1 ? "slide-in-from-right-3" : "slide-in-from-left-3"
  }`;

  const stepIndicator = (
    <div
      className="flex items-center justify-center gap-1.5"
      aria-live="polite"
      aria-label={`Step ${step} of 3`}
    >
      {[1, 2, 3].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`h-[3px] w-5 rounded-full transition-colors duration-200 ${
            index <= step ? "bg-text" : "bg-border"
          }`}
        />
      ))}
    </div>
  );

  // Duplicate probe hit an existing account (or the authoritative signup
  // submit raced the probe): tell the user directly and hand off to
  // sign-in with the email pre-filled.
  if (emailTaken) {
    const lastUsed = getLastAuthMethod(email.trim());
    return (
      <AuthShell>
        <div className="text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="outline-none text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text"
          >
            You already have an account.
          </h1>
          <p className="mt-2 text-[13px] text-text-muted">
            An account already exists for {email.trim()}.
          </p>
          <div className="mt-8 grid gap-5">
            {lastUsed ? (
              <p className="text-[13px] text-text-muted">
                You last signed in with{" "}
                {lastUsed === "password"
                  ? "your password"
                  : lastUsed === "google"
                    ? "Google"
                    : "GitHub"}
                .
              </p>
            ) : null}
            <Link
              to={`/auth/log-in?email=${encodeURIComponent(email.trim())}`}
              className="inline-flex h-10 w-fit items-center justify-center self-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={() => {
                setEmailTaken(false);
                setEmail("");
                setPassword("");
                goTo(1);
              }}
              className="text-[13px] font-medium text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              Use a different email
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {stepIndicator}
      <div key={step} className={`mt-4 ${stepAnimation}`}>
        <div className="text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="outline-none text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text"
          >
            {step === 1
              ? "Let's get you started"
              : step === 2
                ? "Secure your account"
                : "Tell us about yourself"}
          </h1>
          <p className="mt-2 text-[13px] text-text-muted">
            {step === 1
              ? "Enter your email to create your Prism account."
              : step === 2
                ? "Choose a password for your Prism account."
                : "Give us your name and a home for your projects."}
          </p>
        </div>

        {step === 1 ? (
          <div className="mt-8 grid gap-5">
            {oauthError ? <AuthAlert>{oauthError}</AuthAlert> : null}
            <SocialAuthButtons
              providers={{ github: true, google: true }}
              onSocial={onSocial}
            />
            {providerNotice ? (
              <p
                role="status"
                className="text-center text-[12px] leading-relaxed text-text-muted"
              >
                {providerNotice}
              </p>
            ) : null}
            <OrEmailDivider />
            <form onSubmit={onSubmitEmail} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  aria-invalid={Boolean(emailError)}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder="you@company.com"
                  className="h-10"
                />
                {emailError ? (
                  <p role="alert" className="text-xs text-danger">
                    {emailError}
                  </p>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={checking}
                className="flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Continue
              </button>
            </form>
            <p className="text-center text-[13px] text-text-muted">
              Already have an account?{" "}
              <Link
                to="/auth/log-in"
                className="font-medium text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              >
                Sign in
              </Link>
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-8 grid gap-5">
            <div className="flex items-center justify-between gap-3 rounded-full border border-border bg-surface-raised px-3.5 py-2">
              <span className="truncate text-[13px] text-text">{email.trim()}</span>
              <button
                type="button"
                onClick={() => goTo(1)}
                className="shrink-0 text-[13px] font-medium text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Edit
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (password.length >= 8) goTo(3);
              }}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <PasswordInput
                  id="password"
                  label="Password"
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                />
                <p
                  className={`flex items-center gap-1.5 text-xs ${
                    password.length >= 8 ? "text-success" : "text-text-subtle"
                  }`}
                  aria-live="polite"
                >
                  {password.length >= 8 ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : null}
                  At least 8 characters
                </p>
              </div>
              <button
                type="submit"
                disabled={password.length < 8}
                className="flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
              >
                Continue
              </button>
            </form>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-8 grid gap-5">
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jane Smith"
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workspace">Workspace name</Label>
                <Input
                  id="workspace"
                  autoComplete="organization"
                  required
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder="Acme Inc."
                  className="h-10"
                />
                <p className="text-xs text-text-muted">
                  Your workspace holds your projects and teammates. You can
                  rename it later.
                </p>
              </div>
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              <button
                type="submit"
                aria-busy={isPending}
                disabled={isPending || !name.trim() || !workspaceName.trim()}
                className="flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create account
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </AuthShell>
  );
}

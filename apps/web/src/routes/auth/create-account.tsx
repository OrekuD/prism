import { Loader2 } from "lucide-react";
import React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authClient, fetchEnabledProviders } from "@/lib/authClient";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthHeading, AuthShell, OrEmailDivider } from "@/components/auth/auth-shell";
import { isNetworkError, oauthErrorMessage } from "@/components/auth/auth-errors";
import { PasswordInput } from "@/components/auth/password-input";
import {
  type EnabledProviders,
  SocialAuthButtons,
} from "@/components/auth/social-auth-buttons";
import { waitForSession } from "@/lib/session";
import { loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtimeConfig";
import { TELEMETRY_EVENTS, trackTelemetry } from "@/lib/telemetry";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateAccount() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [pendingProvider, setPendingProvider] = React.useState<
    "github" | "google" | null
  >(null);
  const [providers, setProviders] = React.useState<EnabledProviders>({
    github: false,
    google: false,
  });
  const [config, setConfig] = React.useState<RuntimeConfig | null>(null);
  React.useEffect(() => {
    fetchEnabledProviders().then(setProviders);
    loadRuntimeConfig().then(setConfig);
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return; // duplicate-submit guard
    setError(null);
    setIsPending(true);
    try {
      const response = await authClient.signUp.email({ email, password, name });
      if (response.error) {
        setError(
          isNetworkError(response.error)
            ? "Cannot reach Prism. Check your connection and try again."
            : (response.error.message ?? "Something went wrong. Try again."),
        );
        return;
      }
      trackTelemetry(TELEMETRY_EVENTS.signupMethod, { method: "email" });
      // Sign-up creates a session immediately, even with verification
      // pending, so wait until the router sees it before navigating —
      // otherwise the signed-out tree 404s the destination. Verified
      // accounts continue into onboarding; unverified ones land on the
      // dashboard, where the verification banner offers a resend.
      await waitForSession();
      navigate(
        response.data?.user?.emailVerified ? "/onboarding" : "/projects",
        { replace: true },
      );
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Something went wrong. Try again.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const onSocial = async (provider: "github" | "google") => {
    if (pendingProvider) return; // duplicate-submit guard
    setError(null);
    setPendingProvider(provider);
    try {
      const response = await authClient.signIn.social({
        provider,
        callbackURL: "/projects",
      });
      if (response.error) {
        setError("Sign-in with the provider failed. Try again.");
        return;
      }
      if (response.data?.url) {
        trackTelemetry(TELEMETRY_EVENTS.signupMethod, {
          method: provider,
        });
        window.location.assign(response.data.url);
      }
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Sign-in with the provider failed. Try again.",
      );
      setPendingProvider(null);
    }
  };

  const registrationClosed =
    config?.signupPolicy === "disabled" || config?.signupPolicy === "invite-only";

  const selfHosted = config?.deploymentMode === "self-hosted";

  return (
    <AuthShell>
      {registrationClosed && config ? (
        <div className="grid gap-6">
          <AuthHeading
            title="Registration is closed."
            description={
              config.signupPolicy === "invite-only"
                ? `Accounts on ${config.instanceName} are created by invitation only.`
                : `New accounts on ${config.instanceName} are not being accepted right now.`
            }
          />
          <p className="text-[14px] leading-relaxed text-text-muted">
            {config.signupPolicy === "invite-only"
              ? "Use the invite link you received, or sign in if you already have an account."
              : "Sign in if you already have an account, or contact the instance operator."}
          </p>
          <Link
            to="/auth/log-in"
            className="inline-flex h-10 w-fit items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <div className="grid gap-6">
          <AuthHeading
            title={selfHosted ? `Create an account on ${config?.instanceName ?? "this instance"}.` : "Create your account."}
            description="A personal workspace is created for you automatically."
          />
          <div className="grid gap-4">
            {oauthError ? <AuthAlert>{oauthError}</AuthAlert> : null}
            {error ? <AuthAlert>{error}</AuthAlert> : null}
            <SocialAuthButtons
              providers={providers}
              onSocial={onSocial}
              pendingProvider={pendingProvider}
            />
            <OrEmailDivider />
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-10"
                />
              </div>
              <PasswordInput
                id="password"
                label="Password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                hint="At least 8 characters."
              />
              <button
                type="submit"
                aria-busy={isPending}
                disabled={isPending}
                className="flex h-10 items-center justify-center gap-2 rounded-[2px] bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create account
              </button>
            </form>
            <Link
              to="/auth/log-in"
              className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

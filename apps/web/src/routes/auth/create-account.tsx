import { Loader2, Mail } from "lucide-react";
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
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Keep the address mostly hidden while still confirming the destination. */
function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

const RESEND_COOLDOWN_SECONDS = 60;

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
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [providers, setProviders] = React.useState<EnabledProviders>({
    github: false,
    google: false,
  });
  const { resend, isPending: isResendPending } = useResendVerificationEmail();
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    fetchEnabledProviders().then(setProviders);
  }, []);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

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
      if (response.data?.user?.emailVerified) {
        // Local development auto-verifies new users: continue directly.
        navigate("/projects");
        return;
      }
      // Hosted flow: wait for the verification click before provisioning.
      setSentTo(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
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

  const onResend = () => {
    if (cooldown > 0) return;
    if (!sentTo) return;
    resend(sentTo);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <AuthShell>
      {sentTo ? (
        <div className="grid gap-6">
          <AuthHeading
            title="Check your email."
            description="Confirm the address to finish creating your account."
          />
          <div className="grid gap-4">
            <div className="grid size-10 place-items-center rounded-[2px] border border-border bg-surface-raised">
              <Mail className="size-4 text-text-muted" aria-hidden="true" />
            </div>
            <p className="text-[14px] leading-relaxed text-text-muted">
              We sent a confirmation link to{" "}
              <span className="font-medium text-text">
                {redactEmail(sentTo)}
              </span>
              . Your team and workspace are created once the address is
              confirmed.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onResend}
                disabled={cooldown > 0 || isResendPending}
                aria-busy={isResendPending}
                className="inline-flex h-10 items-center gap-2 rounded-[2px] border border-border-strong px-4 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover disabled:opacity-45"
              >
                {isResendPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : "Resend verification email"}
              </button>
            </div>
            <Link
              to="/auth/log-in"
              className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          <AuthHeading
            title="Create your account."
            description="A personal team and workspace are created for you automatically."
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

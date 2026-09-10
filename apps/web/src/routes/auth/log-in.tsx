import { Loader2 } from "@/components/ui/hugeicons";
import React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { authClient } from "@/lib/authClient";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  isNetworkError,
  oauthErrorMessage,
} from "@/components/auth/auth-errors";
import { waitForSession } from "@/lib/session";
import { resolveDefaultWorkspacePath } from "@/lib/workspace";
import { getLastAuthMethod, setLastAuthMethod } from "@/lib/lastAuth";
import { PasswordInput } from "@/components/auth/password-input";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LogIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  // ?email= prefill — used by the signup "account exists" hand-off so the
  // user lands on sign-in with their address already filled.
  const [email, setEmail] = React.useState(
    () => searchParams.get("email") ?? ""
  );
  const lastUsed = email.trim() ? getLastAuthMethod(email.trim()) : null;
  const [password, setPassword] = React.useState("");
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (oauthError) toast.error(oauthError);
  }, [oauthError]);
  const [providerNotice, setProviderNotice] = React.useState<string | null>(
    null
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return; // duplicate-submit guard
    setIsPending(true);
    try {
      const response = await authClient.signIn.email({ email, password });
      if (response.error) {
        // Non-enumerating: same message for every credential failure.
        toast.error("Invalid email or password.");
        setIsPending(false);
        return;
      }
      // Wait for the session to be durable before loading organization data.
      // Better Auth's organization endpoints require the cookie session, so
      // starting this lookup earlier creates a guaranteed post-sign-in 401.
      if (!(await waitForSession())) {
        throw new Error("Session confirmation timed out");
      }
      // Record the successful method so future visits show the "Last used"
      // hint on the right button (and the signup hand-off can reference it).
      setLastAuthMethod(email.trim(), "password");
      const home = await resolveDefaultWorkspacePath();
      navigate(home, { replace: true });
      // Keep the button busy until the destination replaces this route.
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Something went wrong. Please try again."
      );
      setIsPending(false);
    }
  };

  const onSocial = (provider: "github" | "google") => {
    // Presentation only until provider sign-in is enabled in a separate task.
    setProviderNotice(
      `${provider === "github" ? "GitHub" : "Google"} sign-in isn't available yet. Please use email and password.`
    );
  };

  return (
    <AuthShell title="Sign in to Prism" redirectPaused={isPending}>
      <div className="text-center">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text">
          Sign in to Prism
        </h1>
        <p className="mt-2 text-[13px] text-text-muted">
          Welcome back. Pick up where you left off.
        </p>
      </div>
      <div className="mt-8 grid gap-5">
        <SocialAuthButtons
          providers={{ github: true, google: true }}
          onSocial={onSocial}
          lastUsed={
            lastUsed === "github" || lastUsed === "google" ? lastUsed : null
          }
        />
        {providerNotice ? (
          <p
            aria-live="polite"
            className="text-center text-[12px] leading-relaxed text-text-muted"
          >
            {providerNotice}
          </p>
        ) : null}
        <div className="flex items-center gap-4 py-1">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          <span className="text-[12px] text-text-muted">
            or continue with email
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="email">Email</Label>
              {lastUsed === "password" ? (
                <span
                  aria-hidden="true"
                  className="rounded-full border border-border bg-canvas px-1.5 py-px text-[9px] font-medium leading-[1.4] tracking-normal text-text-muted"
                >
                  Last used
                </span>
              ) : null}
            </div>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10"
            />
          </div>
          <PasswordInput
            id="password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <Link
            to="/auth/forgot-password"
            className="-mt-1 justify-self-end text-[12px] text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            Forgot password?
          </Link>
          <button
            type="submit"
            aria-busy={isPending}
            disabled={isPending}
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Sign in
          </button>
        </form>
        <p className="mt-1 text-center text-[13px] text-text-muted">
          New to Prism?{" "}
          <Link
            to="/auth/create-account"
            className="font-medium text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            Create account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

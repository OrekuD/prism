import { Loader2 } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthShell } from "@/components/auth/auth-shell";
import { isNetworkError } from "@/components/auth/auth-errors";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPassword() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return; // duplicate-submit guard
    setError(null);
    setIsPending(true);
    try {
      const response = await authClient.requestPasswordReset({
        email,
        // Send the reset link back to the app's reset screen, not the API's
        // built-in error page (Better Auth appends ?callbackURL= to the link).
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (response.error) {
        // Identical response for known and unknown accounts: no enumeration.
        setSubmitted(true);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AuthShell title="Reset your password.">
      {submitted ? (
        <div className="text-center">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text">
            Check your email.
          </h1>
          <p className="mt-2 text-[13px] text-text-muted">
            We sent you a link to set a new password.
          </p>
          <div className="mt-8 grid gap-5">
            <p className="text-[13px] leading-relaxed text-text-muted">
              If an account exists for that address, the reset link is on its
              way. It expires after a short window.
            </p>
            <Link
              to="/auth/log-in"
              className="text-[13px] text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-center">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.03em] text-text">
              Reset your password.
            </h1>
            <p className="mt-2 text-[13px] text-text-muted">
              We'll email you a link to set a new password.
            </p>
          </div>
          <form onSubmit={onSubmit} className="mt-8 grid gap-4">
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
            {error ? <AuthAlert>{error}</AuthAlert> : null}
            <button
              type="submit"
              aria-busy={isPending}
              disabled={isPending}
              className="flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Send reset link
            </button>
          </form>
          <p className="mt-5 text-center text-[13px] text-text-muted">
            <Link
              to="/auth/log-in"
              className="font-medium text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      )}
    </AuthShell>
  );
}

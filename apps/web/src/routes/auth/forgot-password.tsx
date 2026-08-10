import { Loader2 } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
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
      const response = await authClient.requestPasswordReset({ email });
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
    <AuthShell>
      {submitted ? (
        <div className="grid gap-6">
          <AuthHeading
            title="Check your email."
            description="We sent you a link to set a new password."
          />
          <p className="text-[14px] leading-relaxed text-text-muted">
            If an account exists for that address, the reset link is on its
            way. It expires after a short window.
          </p>
          <Link
            to="/auth/log-in"
            className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <div className="grid gap-6">
          <AuthHeading
            title="Reset your password."
            description="We'll email you a link to set a new password."
          />
          <form onSubmit={onSubmit} className="grid gap-4">
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
              className="flex h-10 items-center justify-center gap-2 rounded-[2px] bg-accent text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Send reset link
            </button>
          </form>
          <Link
            to="/auth/log-in"
            className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

import { Loader2 } from "lucide-react";
import React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { AuthAlert } from "@/components/auth/auth-alert";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { isNetworkError } from "@/components/auth/auth-errors";
import { PasswordInput } from "@/components/auth/password-input";

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [invalidLink, setInvalidLink] = React.useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return; // duplicate-submit guard
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsPending(true);
    try {
      const response = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (response.error) {
        setInvalidLink(true);
        return;
      }
      navigate("/auth/log-in");
    } catch (err) {
      if (isNetworkError(err)) {
        setError("Cannot reach Prism. Check your connection and try again.");
      } else {
        setInvalidLink(true);
      }
    } finally {
      setIsPending(false);
    }
  };

  if (!token || invalidLink) {
    return (
      <AuthShell>
        <div className="grid gap-6">
          <AuthHeading
            title="Invalid or expired link."
            description="Reset links expire after a short window."
          />
          <p className="text-[14px] leading-relaxed text-text-muted">
            Request a new link and try again. If the problem persists, check
            that you opened the full link from the email.
          </p>
          <Link
            to="/auth/forgot-password"
            className="inline-flex h-10 w-fit items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
          >
            Request a new link
          </Link>
          <Link
            to="/auth/log-in"
            className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="grid gap-6">
        <AuthHeading
          title="Set a new password."
          description="Choose a strong password you don't use anywhere else."
        />
        <form onSubmit={onSubmit} className="grid gap-4">
          <PasswordInput
            id="password"
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            hint="At least 8 characters."
          />
          <PasswordInput
            id="confirm"
            label="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
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
            Reset password
          </button>
        </form>
        <Link
          to="/auth/log-in"
          className="w-fit text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

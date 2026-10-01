import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "@/components/ui/hugeicons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Frame, SectionLabel } from "@/components/public/frame";
import { authClient } from "@/lib/authClient";

export function AccountSecurity() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const onChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsPending(true);
    try {
      await authClient.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated");
    } catch (err) {
      setError(
        "Could not change the password. Check your current password.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const onSignOutAll = async () => {
    setMessage(null);
    setError(null);
    try {
      await authClient.revokeSessions();
      window.location.href = "/auth/log-in";
    } catch {
      setError("Could not revoke sessions.");
    }
  };

  const onDeleteAccount = async () => {
    setMessage(null);
    setError(null);
    try {
      await authClient.deleteUser();
      window.location.href = "/auth/log-in";
    } catch {
      setError("Could not delete the account.");
    }
  };

  return (
    <div className="grid gap-6">
      <Frame className="p-6">
        <SectionLabel>Password</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Change your account password.
        </p>
        <form
          onSubmit={onChangePassword}
          className="mt-4 grid max-w-[420px] gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          {message ? (
            <p className="text-[13px] text-success">{message}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              className="rounded-full"
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Update password"
              )}
            </Button>
          </div>
        </form>
      </Frame>

      <Frame className="p-6">
        <SectionLabel>Sessions</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Sign out of every device. This revokes all active sessions.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 rounded-full"
          onClick={onSignOutAll}
        >
          Sign out of all sessions
        </Button>
      </Frame>

      <Frame destructive className="p-6">
        <SectionLabel className="text-danger">Danger zone</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Permanently delete your account and all associated data.
        </p>
        <Button
          type="button"
          variant="destructive"
          className="mt-4 rounded-full"
          onClick={onDeleteAccount}
        >
          Delete account
        </Button>
      </Frame>
    </div>
  );
}

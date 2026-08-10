import { Loader2 } from "lucide-react";
import React from "react";
import { authClient } from "@/lib/authClient";
import { loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtimeConfig";
import { Frame, SectionLabel } from "@/components/public/frame";
import { AuthAlert } from "@/components/auth/auth-alert";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNetworkError } from "@/components/auth/auth-errors";

const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

/**
 * First-owner setup for self-hosted instances (task-5 12.2, task-6 4).
 * Shown only when the runtime config reports setupRequired (self-hosted
 * mode with an empty database). Creates the local owner through the
 * one-time POST /api/v1/setup/owner endpoint, then signs in locally.
 * No Prism cloud is involved at any point.
 */
export function OwnerSetup({
  onComplete,
}: {
  /** Called after the owner is created and signed in. */
  onComplete: () => void;
}) {
  const [config, setConfig] = React.useState<RuntimeConfig | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    setIsPending(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/setup/owner`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!response.ok) {
        setError(
          response.status === 404
            ? "Setup is no longer available on this instance."
            : "Could not create the owner account. Check the instance configuration.",
        );
        return;
      }
      // The owner exists now: sign in locally and continue onboarding.
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) {
        setError("Owner created, but sign-in failed. Try signing in manually.");
        return;
      }
      onComplete();
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Cannot reach this instance. Check the URL and try again."
          : "Could not create the owner account.",
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Frame className="min-h-[520px]">
      <div className="grid md:grid-cols-[58fr_42fr]">
        <div className="border-b border-border p-6 sm:p-8 md:border-b-0 md:border-r">
          <div className="grid gap-6">
            <div>
              <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                Create the owner account
              </h2>
              <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-text-muted">
                This is the first account on this instance. It becomes the
                administrator and is the only account the setup flow can
                create; registration policy applies from here on.
              </p>
            </div>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="owner-name">Name</Label>
                <Input
                  id="owner-name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="owner-email">Email</Label>
                <Input
                  id="owner-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-10"
                />
              </div>
              <PasswordInput
                id="owner-password"
                label="Password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                hint="At least 8 characters."
              />
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              <button
                type="submit"
                aria-busy={isPending}
                disabled={isPending}
                className="flex h-10 w-fit items-center gap-2 rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover disabled:opacity-45"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create owner account
              </button>
            </form>
          </div>
        </div>
        <aside className="bg-canvas-subtle p-6 sm:p-8">
          <div className="grid gap-3">
            <SectionLabel prefix={null}>Instance</SectionLabel>
            <dl className="grid gap-2.5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-text-subtle">Name</dt>
                <dd className="text-text">{config?.instanceName ?? "…"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-subtle">Public URL</dt>
                <dd className="font-mono text-[12px] text-text">
                  {config?.baseUrl ?? "…"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-subtle">Registration</dt>
                <dd className="text-text">
                  {config?.signupPolicy === "open"
                    ? "Open"
                    : config?.signupPolicy === "invite-only"
                      ? "Invite only"
                      : "Disabled"}
                </dd>
              </div>
            </dl>
            <p className="pt-2 text-[12px] leading-relaxed text-text-subtle">
              Instance settings live in the deployment environment
              (PRISM_DEPLOYMENT_MODE, INSTANCE_NAME, SIGNUP_POLICY, BASE_URL).
              No data leaves this instance.
            </p>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

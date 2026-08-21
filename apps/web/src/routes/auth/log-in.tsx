import { Loader2 } from "lucide-react";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { authClient, fetchEnabledProviders } from "@/lib/authClient";
import { AuthHeading, AuthShell, OrEmailDivider } from "@/components/auth/auth-shell";
import { isNetworkError, oauthErrorMessage } from "@/components/auth/auth-errors";
import { waitForSession } from "@/lib/session";
import { resolveDefaultWorkspacePath } from "@/lib/workspace";
import { PasswordInput } from "@/components/auth/password-input";
import {
  type EnabledProviders,
  SocialAuthButtons,
} from "@/components/auth/social-auth-buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LogIn() {
  const [searchParams] = useSearchParams();
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (oauthError) toast.error(oauthError);
  }, [oauthError]);
  const [pendingProvider, setPendingProvider] = React.useState<
    "github" | "google" | null
  >(null);
  const [providers, setProviders] = React.useState<EnabledProviders>({
    github: false,
    google: false,
  });

  React.useEffect(() => {
    fetchEnabledProviders().then(setProviders);
  }, []);

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
      await waitForSession();
      const home = await resolveDefaultWorkspacePath();
      // A full navigation (fresh boot) reads the confirmed session cookie, so
      // the router never briefly sees a signed-out state and bounces back.
      window.location.assign(home || "/overview");
      // Leave isPending true: the page unloads on navigation.
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Something went wrong. Please try again.",
      );
      setIsPending(false);
    }
  };

  const onSocial = async (provider: "github" | "google") => {
    if (pendingProvider) return; // duplicate-submit guard
    setPendingProvider(provider);
    try {
      const response = await authClient.signIn.social({
        provider,
        callbackURL: "/overview",
      });
      if (response.error) {
        toast.error("Sign-in with the provider failed. Try again.");
        return;
      }
      if (response.data?.url) {
        window.location.assign(response.data.url);
      }
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? "Cannot reach Prism. Check your connection and try again."
          : "Sign-in with the provider failed. Try again.",
      );
      setPendingProvider(null);
    }
  };

  return (
    <AuthShell>
      <AuthHeading title="Welcome back." description="Use your Prism account to continue." />
      <div className="mt-8 grid gap-4">
        <SocialAuthButtons
          providers={providers}
          onSocial={onSocial}
          pendingProvider={pendingProvider}
        />
        <OrEmailDivider />
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
          <PasswordInput
            id="password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
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
            Sign in
          </button>
        </form>
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/auth/log-in"
            className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
          >
            Forgot password
          </Link>
          <Link
            to="/auth/create-account"
            className="text-[13px] font-medium text-link transition-colors duration-150 hover:underline"
          >
            Create account
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

import { Loader2 } from "lucide-react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { authClient, fetchEnabledProviders } from "@/lib/authClient";
import { AuthHeading, AuthShell, OrEmailDivider } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";
import {
  type EnabledProviders,
  SocialAuthButtons,
} from "@/components/auth/social-auth-buttons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LogIn() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [providers, setProviders] = React.useState<EnabledProviders>({
    github: false,
    google: false,
  });

  React.useEffect(() => {
    fetchEnabledProviders().then(setProviders);
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await authClient.signIn.email({ email, password });
      navigate("/projects");
    } catch {
      // Non-enumerating: same message for every failure mode.
      setError("Invalid email or password.");
    } finally {
      setIsPending(false);
    }
  };

  const onSocial = (provider: "github" | "google") => {
    authClient.signIn.social({ provider, callbackURL: "/projects" });
  };

  return (
    <AuthShell>
      <AuthHeading title="Welcome back." description="Use your Prism account to continue." />
      <div className="mt-8 grid gap-4">
        <SocialAuthButtons providers={providers} onSocial={onSocial} />
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
          {error ? (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
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
            to="/auth/forgot-password"
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

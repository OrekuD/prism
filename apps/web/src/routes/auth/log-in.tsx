import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { authClient, fetchEnabledProviders } from "@/lib/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

export function LogIn() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const [providers, setProviders] = React.useState<{
    github: boolean;
    google: boolean;
  }>({ github: false, google: false });

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
    } catch (err) {
      setError("Invalid email or password");
    } finally {
      setIsPending(false);
    }
  };

  const onSocial = (provider: "github" | "google") => {
    authClient.signIn.social({ provider, callbackURL: "/projects" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Prism</CardTitle>
          <CardDescription>Enter your credentials below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button type="submit" disabled={isPending}>
              {isPending ? <LoadingSpinner /> : "Sign in"}
            </Button>
          </form>
          {(providers.github || providers.google) ? (
            <div className="mt-4 grid gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or continue with
                <span className="h-px flex-1 bg-border" />
              </div>
              {providers.github ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSocial("github")}
                >
                  GitHub
                </Button>
              ) : null}
              {providers.google ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSocial("google")}
                >
                  Google
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col items-start gap-2">
          <Link
            to="/auth/forgot-password"
            className="text-sm text-muted-foreground hover:underline"
          >
            Forgot your password?
          </Link>
          <Link
            to="/auth/create-account"
            className="text-sm text-muted-foreground hover:underline"
          >
            Don't have an account? Create one
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

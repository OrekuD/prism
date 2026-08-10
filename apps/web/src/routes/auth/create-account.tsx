import { Loader2 } from "lucide-react";
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


export function CreateAccount() {
  const navigate = useNavigate();
  const [name, setName] = React.useState("");
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
      await authClient.signUp.email({ email, password, name });
      navigate("/projects");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setError(message);
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
          <CardTitle>Create your Prism account</CardTitle>
          <CardDescription>
            A personal team and workspace are created for you automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
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
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : "Create account"}
            </Button>
          </form>
          {(providers.github || providers.google) ? (
            <div className="mt-4 grid gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or sign up with
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
        <CardFooter>
          <Link
            to="/auth/log-in"
            className="text-sm text-muted-foreground hover:underline"
          >
            Already have an account? Sign in
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

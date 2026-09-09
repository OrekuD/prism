import { Loader2 } from "@/components/ui/lucide-icons";
import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { authClient, authBaseUrl, fetchEnabledProviders } from "@/lib/authClient";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";

type LinkedAccount = { provider: string; accountId: string };

export function AccountAuthentication() {
  const { data: sessionData } = authClient.useSession();
  const emailVerified = Boolean(sessionData?.user?.emailVerified);
  const { resend, isPending: isResendPending } = useResendVerificationEmail();
  const [userName, setUserName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [accounts, setAccounts] = React.useState<Array<LinkedAccount>>([]);
  const [providers, setProviders] = React.useState<{
    github: boolean;
    google: boolean;
  }>({ github: false, google: false });
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  const loadAccounts = React.useCallback(async () => {
    try {
      const result = (await authClient.listAccounts()) as unknown as {
        data?: Array<{ providerId: string; accountId: string }>;
      };
      setAccounts(
        (result?.data ?? []).map((account) => ({
          provider: account.providerId,
          accountId: account.accountId,
        })),
      );
    } catch {
      setAccounts([]);
    }
  }, []);

  React.useEffect(() => {
    loadAccounts();
    fetchEnabledProviders().then(setProviders);
  }, [loadAccounts]);

  const onUpdateUsername = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsPending(true);
    try {
      const response = await fetch(`${authBaseUrl}/api/auth/update-user`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userName }),
      });
      if (!response.ok) {
        throw new Error("update failed");
      }
      setMessage("Username updated");
    } catch {
      setError("Could not update the username.");
    } finally {
      setIsPending(false);
    }
  };

  const onChangeEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsPending(true);
    try {
      await authClient.changeEmail({ newEmail: email });
      setMessage("A verification email has been sent to the new address.");
      setEmail("");
    } catch {
      setError("Could not change the email.");
    } finally {
      setIsPending(false);
    }
  };

  const onLinkProvider = async (provider: "github" | "google") => {
    setMessage(null);
    setError(null);
    try {
      await authClient.linkSocial({ provider } as never);
      await loadAccounts();
    } catch {
      setError("Could not link that provider.");
    }
  };

  return (
    <div className="grid gap-6">
      {!emailVerified ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              A verified email is required to create workspaces, projects, and
              invite members.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">
                {sessionData?.user?.email}
              </span>
              . Didn't receive it?
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={isResendPending}
              onClick={() => {
                if (sessionData?.user?.email) {
                  resend(sessionData.user.email);
                }
              }}
            >
              {isResendPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Resend verification email"
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Username</CardTitle>
          <CardDescription>Your Prism URL namespace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onUpdateUsername} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={userName}
                onChange={(event) => setUserName(event.target.value)}
              />
            </div>
            {message ? (
              <p className="text-sm text-emerald-600">{message}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={isPending} className="w-fit">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Email</CardTitle>
          <CardDescription>
            Change your account email. A verification email is sent to the new
            address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onChangeEmail} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="new-email">New email</Label>
              <Input
                id="new-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={isPending} className="w-fit">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : "Update email"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Linked accounts</CardTitle>
          <CardDescription>
            Sign in with GitHub or Google using the same email address.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No social accounts linked yet.
            </p>
          ) : (
            accounts.map((account) => (
              <p key={account.provider} className="text-sm">
                <span className="font-medium capitalize">{account.provider}</span>
                <span className="text-muted-foreground"> — {account.accountId}</span>
              </p>
            ))
          )}
          <div className="flex gap-2 pt-2">
            {providers.github ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onLinkProvider("github")}
              >
                Link GitHub
              </Button>
            ) : null}
            {providers.google ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onLinkProvider("google")}
              >
                Link Google
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

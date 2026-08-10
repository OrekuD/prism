/**
 * Distinguishes network failures from API errors so auth pages never
 * report "invalid credentials" when the network is the problem
 * (design-system.md 11.5).
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const cause = (error as { cause?: unknown })?.cause;
  return (
    cause instanceof TypeError ||
    (typeof cause === "object" &&
      cause !== null &&
      (cause as { name?: string })?.name === "TypeError")
  );
}

/**
 * Maps better-auth OAuth callback error parameters (?error=...) to a
 * plain-language explanation (design-system.md 11.5).
 */
export function oauthErrorMessage(error: string | null): string | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (normalized.includes("access_denied") || normalized.includes("denied")) {
    return "You denied access to your account. Return to sign in and try again.";
  }
  if (normalized.includes("account_not_linked") || normalized.includes("not_linked")) {
    return "This provider account is not linked to a Prism account. Sign in with the method you used originally, or create a new account.";
  }
  if (normalized.includes("invalid_state") || normalized.includes("state")) {
    return "The sign-in session expired. Try again.";
  }
  return "Sign-in with the provider failed. Try again.";
}

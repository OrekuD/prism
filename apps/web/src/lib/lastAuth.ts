/**
 * Per-email record of the sign-in method last used successfully
 * ("password" | "github" | "google"), so auth screens can hint
 * "Last used" on the right button. Falls back to a global record for
 * social attempts made before an email was known. localStorage only —
 * advisory UX, never security-relevant, and wrapped so private-mode or
 * blocked storage degrades to no badge.
 */
const KEY_PREFIX = "prism.lastAuth:";
const GLOBAL_KEY = "prism.lastAuth";

export type LastAuthMethod = "password" | "github" | "google";

const METHODS: LastAuthMethod[] = ["password", "github", "google"];

function parse(value: string | null): LastAuthMethod | null {
  return METHODS.includes(value as LastAuthMethod)
    ? (value as LastAuthMethod)
    : null;
}

export function getLastAuthMethod(
  email?: string | null,
): LastAuthMethod | null {
  try {
    if (email) {
      const perEmail = parse(localStorage.getItem(KEY_PREFIX + email.trim().toLowerCase()));
      if (perEmail) return perEmail;
    }
    return parse(localStorage.getItem(GLOBAL_KEY));
  } catch {
    return null;
  }
}

export function setLastAuthMethod(
  email: string | null | undefined,
  method: LastAuthMethod,
): void {
  try {
    if (email) {
      localStorage.setItem(KEY_PREFIX + email.trim().toLowerCase(), method);
    }
    localStorage.setItem(GLOBAL_KEY, method);
  } catch {
    // Storage unavailable (private mode): the feature silently no-ops.
  }
}

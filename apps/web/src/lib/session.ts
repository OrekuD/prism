import { authClient } from "@/lib/authClient";

/**
 * The session atom that `useSession` reads, plus its refetch function
 * (the same one `useSession().data.refetch` calls). The React client
 * exposes it on the auth client as `$store.atoms.session`.
 */
type SessionAtomState = {
  data: { session?: { id: string } } | null;
  isPending: boolean;
  refetch: () => Promise<unknown>;
};

function sessionAtom(): SessionAtomState | null {
  const atom = (authClient as unknown as {
    $store: { atoms: { session: { get(): SessionAtomState } } };
  }).$store?.atoms?.session;
  return atom ? atom.get() : null;
}

/**
 * Makes the router see the session before navigating.
 *
 * Sign-up/sign-in resolve before the session becomes visible to
 * `useSession`, so navigating immediately lands in the signed-out tree,
 * which 404s protected paths (observed after account creation). This
 * triggers the atom's own refetch — the exact one `useSession().data
 * .refetch` uses — which updates the atom synchronously before
 * resolving. The router swap and the caller's navigation then commit in
 * the same render, so the destination renders with the authenticated
 * router.
 *
 * @returns true when a session is visible to the router
 */
export async function waitForSession(timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const start = sessionAtom();
  if (start?.data?.session) return true;
  if (start?.refetch) {
    try {
      await start.refetch();
    } catch {
      // Fall through to polling below.
    }
  }
  while (Date.now() < deadline) {
    const state = sessionAtom();
    if (state?.data?.session) return true;
    try {
      const response = await authClient.getSession();
      if (response.data?.session) {
        // A cookie-only read does not update useSession. SPA navigation is
        // safe only after the router's atom has observed that session too.
        const current = sessionAtom();
        if (!current || current.data?.session) return true;
        await current.refetch?.();
        if (sessionAtom()?.data?.session) return true;
      }
      // 429 means the rate limiter fired — back off instead of hammering.
      if ((response as unknown as { error?: { status?: number } })?.error?.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
    } catch {
      // Cookie may not have propagated yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

import React from "react";
import { Navigate } from "react-router-dom";
import { authBaseUrl, authClient } from "@/lib/authClient";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { Frame, SectionLabel } from "@/components/public/frame";
import { PrismMark } from "@/components/brand/prism-mark";
import {
  HomeSkeleton,
  useWorkspaceHome,
} from "@/components/workspace/workspace-scope";

/**
 * Shared authentication shell (design-system.md 11.1-11.2).
 * Two-column zero-gap frame: 42% context panel (canvas-subtle) + 58% form
 * panel, one vertical divider, instance identity visible. Mobile keeps
 * logo/instance identity and one sentence, drops the long context copy.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const { path: homePath, isPending: homePending } = useWorkspaceHome();
  const instanceHost = new URL(authBaseUrl).host;
  const [instanceName, setInstanceName] = React.useState<string>("Prism");

  React.useEffect(() => {
    loadRuntimeConfig().then((config) => {
      setInstanceName(config.instanceName);
      document.title = `${config.instanceName} - sign in`;
    });
  }, []);

  // Already signed in? There's nothing to do here — bounce straight to the
  // dashboard (scoped URL) instead of a vanity path that has to re-resolve.
  if (isAuthenticated) {
    if (homePath) return <Navigate to={homePath} replace />;
    if (homePending) return <HomeSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 py-14 md:px-6 md:py-16">
      <Frame className="min-h-[600px]">
        {/* Rows fill the frame: mobile = identity line auto + form 1fr;
            desktop = one stretched row so both panels reach full height. */}
        <div className="grid min-h-[600px] grid-rows-[auto_1fr] md:grid-cols-[42fr_58fr] md:grid-rows-1">
          <aside className="hidden flex-col border-r border-border bg-canvas-subtle p-10 md:flex">
            <PrismMark size={36} decorative />
            <div className="mt-6">
              <SectionLabel>{instanceName}</SectionLabel>
            </div>
            <p className="mt-8 max-w-[24ch] text-[22px] font-semibold leading-snug tracking-[-0.015em] text-text">
              Realtime product analytics you can run yourself.
            </p>
            <p className="mt-4 max-w-[34ch] text-[13px] leading-relaxed text-text-muted">
              Track sessions and product events with a small SDK. Hosted by us
              or on your own infrastructure.
            </p>
            <div className="mt-auto">
              <p className="text-[13px] font-medium tracking-normal text-text-subtle">
                Instance
              </p>
              <p className="mt-1.5 text-[13px] text-text">
                {instanceHost}
              </p>
            </div>
          </aside>

          {/* Mobile: instance identity + one sentence only. */}
          <div className="border-b border-border bg-canvas-subtle px-5 py-3 md:hidden">
            <p className="text-[11px] tracking-normal text-text-subtle">
              {instanceName} · {instanceHost}
            </p>
            <p className="mt-1 text-[13px] text-text-muted">
              Realtime product analytics you can run yourself.
            </p>
          </div>

          <div className="flex items-center px-5 py-10 sm:px-14 sm:py-12">
            <div className="mx-auto w-full max-w-[420px]">{children}</div>
          </div>
        </div>
      </Frame>
    </div>
  );
}

/** `OR EMAIL` divider with hairlines (design-system.md 11.3). */
export function OrEmailDivider() {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-[10px] tracking-normal text-text-subtle">
        Or email
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Auth page heading pair (product page title in mono, muted description). */
export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-text">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-[14px] text-text-muted">{description}</p>
      ) : null}
    </div>
  );
}

import React from "react";
import { Link } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { Frame, SectionLabel } from "@/components/public/frame";
import { MetricsFrame } from "@/components/charts/metrics-frame";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";

/**
 * Workspace overview (design-system.md 13.1): welcome heading, usage
 * summary across the team's projects, quick links, and the GET STARTED
 * panel until the first project has data.
 */
export function Overview() {
  const { data: sessionData } = authClient.useSession();
  const { data: projects, isLoading } = useProjectsQuery();

  const firstProject = projects?.[0];
  const eventsQuery = useProjectEventsQuery(firstProject?.slug);

  const visitors = React.useMemo(
    () =>
      (projects ?? []).reduce(
        (sum, project) =>
          sum +
          (project.summary?.reduce(
            (rowSum, row) => rowSum + row.desktop + row.mobile,
            0,
          ) ??
            0),
        0,
      ),
    [projects],
  );

  const hasData = visitors > 0 || (eventsQuery.data?.length ?? 0) > 0;
  const firstName = sessionData?.user?.name?.split(/\s+/)[0] ?? "";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-mono text-[26px] font-semibold tracking-[-0.025em] text-text">
          {firstName ? `// Welcome back, ${firstName}` : "// Welcome back"}
        </h1>
        <p className="mt-2 text-[13px] text-text-muted">
          Overview of your Prism workspace
        </p>
      </div>

      <SectionLabel>Usage summary</SectionLabel>
      <MetricsFrame
        isLoading={isLoading}
        cells={[
          {
            id: "visitors",
            label: "Visitors",
            icon: "visitors",
            value: visitors,
            unit: "all time",
          },
          {
            id: "projects",
            label: "Projects",
            icon: "sessions",
            value: projects?.length ?? 0,
            unit: "tracked",
          },
          {
            id: "events",
            label: "Events",
            icon: "events",
            value: eventsQuery.data?.length ?? 0,
            unit: "logged",
          },
        ]}
      />

      <SectionLabel>Quick links</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            {
              label: "Projects",
              description: "Manage tracked applications.",
              to: "/projects",
            },
            {
              label: "API keys",
              description: "Create and rotate project keys.",
              to: "/projects",
            },
            {
              label: "Documentation",
              description: "Install and use the Prism SDK.",
              href: "http://localhost:3000",
            },
          ] as Array<
            { label: string; description: string } & (
              | { to: string }
              | { href: string }
            )
          >
        ).map((link) => (
          <Frame key={link.label} className="min-h-[128px] p-5">
            {"to" in link ? (
              <Link
                to={link.to}
                className="grid h-full gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="font-mono text-[15px] font-semibold text-text">
                  {link.label}
                </span>
                <span className="max-w-[36ch] text-[13px] leading-relaxed text-text-muted">
                  {link.description}
                </span>
              </Link>
            ) : (
              <a
                href={link.href}
                className="grid h-full gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="font-mono text-[15px] font-semibold text-text">
                  {link.label}
                </span>
                <span className="max-w-[36ch] text-[13px] leading-relaxed text-text-muted">
                  {link.description}
                </span>
              </a>
            )}
          </Frame>
        ))}
      </div>

      {hasData ? (
        <>
          <SectionLabel>Recent activity</SectionLabel>
          <Frame className="p-6">
            <p className="text-[13px] leading-relaxed text-text-muted">
              {eventsQuery.data?.length
                ? `The most recent event was ${eventsQuery.data[0].name} at ${new Date(eventsQuery.data[0].occurredAt).toLocaleString()}.`
                : "Sessions are being recorded. Open a project for the full overview."}
            </p>
          </Frame>
        </>
      ) : (
        <>
          <SectionLabel>Get started</SectionLabel>
          <Frame className="p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                  Connect your first project
                </h2>
                <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-text-muted">
                  Add the Prism SDK and verify the first event.
                </p>
              </div>
              <Link
                to="/onboarding"
                className="inline-flex h-9 items-center rounded-[2px] border border-border-strong px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
              >
                Open setup
              </Link>
            </div>
            <div className="mt-5 grid gap-2">
              <CodeCopyRow command="yarn add @prism/core" />
              <CodeCopyRow command={'const prism = new PrismClient("pr_…")'} />
              <CodeCopyRow command={'await prism.logEvent("app_opened", { source: "overview" })'} />
            </div>
          </Frame>
        </>
      )}
    </div>
  );
}

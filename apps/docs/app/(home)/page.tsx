import Link from "next/link";
import { SectionLabel } from "@/components/prism/section-label";
import { Frame } from "@/components/frame";
import { APP_URL } from "@/lib/appUrl";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bug,
  Code2,
  Send,
  Users,
} from "lucide-react";

const PANELS = [
  {
    href: "/docs/features/capturing-events",
    label: "Features",
    title: "Capturing events",
    desc: "Event names, properties, validation, and delivery.",
    icon: Send,
  },
  {
    href: "/docs/features/page-analytics",
    label: "Features",
    title: "Page analytics",
    desc: "Page views and dashboard metrics.",
    icon: BarChart3,
  },
  {
    href: "/docs/features/error-tracking",
    label: "Features",
    title: "Error tracking",
    desc: "Browser, React, and Node capture with grouping.",
    icon: Bug,
  },
  {
    href: "/docs/features/identifying-users",
    label: "Features",
    title: "Identifying users",
    desc: "Identity, traits, People, export, and deletion.",
    icon: Users,
  },
  {
    href: "/docs/features/sessions-and-live-activity",
    label: "Features",
    title: "Sessions and live activity",
    desc: "Client-owned sessions and the Live dashboard.",
    icon: Activity,
  },
  {
    href: "/docs/reference/sdk-api-and-limits",
    label: "Reference",
    title: "SDK API and limits",
    desc: "Packages, ceilings, and the runtime adapter contract.",
    icon: Code2,
  },
];

export default function HomePage() {
  return (
    <>
      <main className="mx-auto w-full max-w-(--fd-layout-width) flex-1 px-4 pb-24 pt-16 md:px-6">
        {/* Hero */}
        <section className="mb-16">
          <SectionLabel label="Prism Docs" />
          <h1 className="mt-3 max-w-[26ch] text-balance text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-fd-foreground md:text-5xl">
            Understand your product{" "}
            <span className="text-fd-muted-foreground">in realtime</span>
          </h1>
          <p className="mt-5 max-w-[58ch] text-base leading-relaxed text-fd-muted-foreground md:text-lg">
            Prism is realtime product analytics for teams: a lightweight browser
            SDK, a high-throughput ingestion service, and a dashboard for
            sessions and events — hosted by us or entirely on your own
            infrastructure.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs/start/quickstart"
              className="inline-flex h-11 items-center gap-2 rounded-[2px] bg-fd-primary px-5 font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            >
              Start with hosted Prism
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href={APP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[2px] border border-fd-border px-5 font-medium text-fd-foreground transition-colors hover:border-fd-primary/60 hover:bg-fd-accent"
            >
              Open Prism
            </a>
          </div>
        </section>

        {/* Quickstart frame */}
        <Frame className="mb-16">
          <div className="border-b border-fd-border px-6 py-4">
            <h2 className="text-base font-semibold text-fd-foreground">
              First event in five minutes
            </h2>
          </div>
          <div className="grid md:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6 border-b border-fd-border p-6 md:border-b-0 md:border-r">
              <CommandRow
                label="sh"
                caption="Install"
                code="npm install @prism-analytics/core"
              />
              <CommandRow
                label="ts"
                caption="Initialize"
                code={[
                  'import { PrismClient } from "@prism-analytics/core";',
                  'const prism = new PrismClient("pr_xxx");',
                ]}
              />
              <CommandRow
                label="ts"
                caption="Track"
                code={[
                  'await prism.logEvent("button-click", { label: "signup" });',
                ]}
              />
            </div>
            <div className="divide-y divide-fd-border">
              <QuickFact
                label="Sessions"
                value="Real-time"
                detail="New sessions appear live on the dashboard"
              />
              <QuickFact
                label="Events"
                value="Named + structured"
                detail="Any event name, with optional JSON data"
              />
              <QuickFact
                label="Keys"
                value="Public write-only"
                detail="Safe to expose in your site's JavaScript"
              />
            </div>
          </div>
        </Frame>

        {/* Choose your path */}
        <section className="mb-16">
          <SectionLabel label="Choose your path" />
          <h2 className="mb-6 mt-3 text-2xl font-semibold tracking-[-0.02em] text-fd-foreground">
            One product, two ways to run it
          </h2>
          <Frame className="grid gap-0 md:grid-cols-2">
            <div className="flex flex-col gap-4 p-6 md:border-r md:border-fd-border">
              <h3 className="text-base font-semibold text-fd-foreground">
                Hosted
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">
                Prism operates everything. Create an account, connect a project,
                ship.
              </p>
              <ul className="space-y-2 text-sm text-fd-foreground">
                {[
                  "Managed stores and infrastructure",
                  "Verified email unlocks project creation",
                  "No first boot, no setup token",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-[7px] size-1.5 shrink-0 rounded-[1px] bg-fd-primary"
                    />
                    {point}
                  </li>
                ))}
              </ul>
              <Link
                href="/docs/start/quickstart"
                className="mt-auto inline-flex h-11 w-fit items-center rounded-[2px] bg-fd-primary px-5 text-[13px] font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              >
                Start hosted
              </Link>
            </div>
            <div className="flex flex-col gap-4 p-6">
              <h3 className="text-base font-semibold text-fd-foreground">
                Self-hosted
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">
                Run the whole stack on your own infrastructure with no outbound
                access.
              </p>
              <ul className="space-y-2 text-sm text-fd-foreground">
                {[
                  "Single-origin Docker Compose stack",
                  "Setup-token first boot, no hosted account",
                  "Egress blocked, no telemetry",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-[7px] size-1.5 shrink-0 rounded-[1px] bg-fd-primary"
                    />
                    {point}
                  </li>
                ))}
              </ul>
              <Link
                href="/docs/self-hosting/self-host-prism"
                className="mt-auto inline-flex h-11 w-fit items-center rounded-[2px] bg-fd-primary px-5 text-[13px] font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              >
                Self-host
              </Link>
            </div>
          </Frame>
        </section>

        {/* Entry panels */}
        <section>
          <SectionLabel label="Explore" />
          <h2 className="mb-6 mt-3 text-2xl font-semibold tracking-[-0.02em] text-fd-foreground">
            Go deeper
          </h2>
          <Frame className="grid gap-px bg-fd-border sm:grid-cols-2 lg:grid-cols-3">
            {PANELS.map(({ href, label, title, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col gap-1.5 bg-fd-background p-5 transition-colors hover:bg-fd-accent"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fd-muted-foreground/70">
                  {label}
                </span>
                <span className="flex items-center gap-2 text-sm font-semibold text-fd-foreground">
                  <Icon className="size-4 text-fd-primary" aria-hidden />
                  {title}
                </span>
                <span className="text-[13px] leading-relaxed text-fd-muted-foreground">
                  {desc}
                </span>
              </Link>
            ))}
          </Frame>
        </section>
      </main>
    </>
  );
}

function CommandRow({
  label,
  caption,
  code,
}: {
  label: string;
  caption: string;
  code: string | string[];
}) {
  const lines = Array.isArray(code) ? code : [code];
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fd-muted-foreground/70">
        {caption}
      </p>
      <div className="flex items-stretch overflow-hidden rounded-[2px] border border-fd-border bg-fd-muted">
        <span className="flex items-center border-r border-fd-border bg-fd-background px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-fd-muted-foreground">
          {label}
        </span>
        <code className="flex-1 overflow-x-auto whitespace-nowrap px-4 py-2.5 font-mono text-[13px] leading-relaxed text-fd-foreground">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </code>
      </div>
    </div>
  );
}

function QuickFact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fd-muted-foreground/70">
        {label}
      </span>
      <span className="font-mono text-[15px] text-fd-foreground">{value}</span>
      <span className="text-[13px] text-fd-muted-foreground">{detail}</span>
    </div>
  );
}

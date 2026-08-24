import React from "react";
import { Link } from "react-router-dom";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { Frame, SectionLabel } from "@/components/public/frame";
import { cn } from "@/lib/utils";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";

/** Redacted example key: never a real secret (design-system.md 9.6). */
const EXAMPLE_KEY = "pr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

const installCommand = "yarn add @prism-analytics/core";
const initializeCommand = `const prism = await createPrismClient({
  sourceKey: "${EXAMPLE_KEY}",
  endpoint: "https://your-prism-instance.example", // runtime choice, never compiled in
  runtime,
  collection: { initialState: "granted" },
});`;
const verifyCommand = `prism.track("app_opened", { source: "landing" });`;

function Hero() {
  return (
    <section className="grid min-h-[calc(100dvh-74px)] min-h-[620px] grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-12 lg:px-10 lg:py-[72px]">
      <div className="lg:col-span-5">
        <SectionLabel>Realtime product analytics</SectionLabel>
        <h1 className="mt-5 text-[38px] font-semibold leading-[1.02] tracking-[-0.035em] text-text sm:text-[52px] sm:tracking-[-0.045em]">
          See what people do.
          <span className="text-text-muted"> As it happens.</span>
        </h1>
        <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-text-muted">
          Track sessions and product events with a small SDK. Run Prism with us
          or on your own infrastructure.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/auth/create-account"
            className="inline-flex h-[42px] items-center rounded-[2px] bg-accent px-[18px] text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
          >
            Start hosted
          </Link>
          <Link
            to="#self-host"
            className="inline-flex h-[42px] items-center rounded-[2px] border border-border-strong px-[18px] text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
          >
            Self-host Prism
          </Link>
        </div>
      </div>

      <div className="lg:col-span-7">
        <Frame className="overflow-hidden p-0">
          <img
            src="/dashboard-preview.png"
            alt="The Prism workspace overview: usage summary, quick links, and the connect-a-project panel"
            width={1600}
            height={1000}
            fetchPriority="high"
            className="block h-auto w-full"
          />
        </Frame>
        <p className="mt-3 px-1 text-[12px] leading-relaxed text-text-subtle">
          The real Prism workspace: usage summary, quick links, and the
          connect-a-project panel.
        </p>
      </div>
    </section>
  );
}

function ProofBand() {
  const facts = [
    {
      label: "Realtime",
      body: "WebSocket session updates as they happen.",
    },
    {
      label: "Events",
      body: "Structured product event payloads with properties.",
    },
    {
      label: "Your data",
      body: "Hosted by us or stored on your own infrastructure.",
    },
  ];
  return (
    <section id="product" aria-label="Product facts" className="px-6 lg:px-10">
      <Frame className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {facts.map((fact) => (
          <div key={fact.label} className="px-6 py-8">
            <SectionLabel prefix={null}>{fact.label}</SectionLabel>
            <p className="mt-3 max-w-[30ch] text-[13px] leading-relaxed text-text-muted">
              {fact.body}
            </p>
          </div>
        ))}
      </Frame>
    </section>
  );
}

const snippets = {
  javascript: [
    ["Install", installCommand],
    ["Initialize", initializeCommand],
    ["Verify", verifyCommand],
  ] as const,
  react: [
    ["Install", installCommand],
    [
      "Initialize",
      `const prism = await createPrismClient({
  sourceKey: "${EXAMPLE_KEY}",
  endpoint: "https://your-prism-instance.example",
  runtime,
  collection: { initialState: "granted" },
});`,
    ],
    [
      "Verify",
      `useEffect(() => {
  prism.track("app_opened", { source: "landing" });
}, []);`,
    ],
  ] as const,
};

function SetupSection() {
  const [framework, setFramework] =
    React.useState<keyof typeof snippets>("javascript");
  const steps = snippets[framework];

  return (
    <section
      aria-label="Connect a project"
      className="px-6 py-16 lg:px-10 lg:py-24"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-text">
            Connect a project
          </h2>
          <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-text-muted">
            Install the SDK, add your project key, and verify the first event.
          </p>
        </div>
        <a
          href={`${VITE_DOCS_URL}/docs/start/quickstart`}
          className="inline-flex h-[36px] items-center rounded-[2px] border border-border-strong px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
        >
          Read the docs
        </a>
      </div>

      <Frame className="mt-8 p-4 sm:p-6">
        <div
          role="tablist"
          aria-label="Framework"
          className="flex gap-1 border-b border-border pb-3"
        >
          {(Object.keys(snippets) as Array<keyof typeof snippets>).map(
            (name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={framework === name}
                onClick={() => setFramework(name)}
                className={cn(
                  "h-[30px] rounded-[2px] px-3 font-mono text-[12px] transition-colors duration-150",
                  framework === name
                    ? "bg-accent text-primary-foreground"
                    : "text-text-muted hover:bg-surface-hover hover:text-text"
                )}
              >
                {name === "javascript" ? "JavaScript" : "React"}
              </button>
            )
          )}
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-[150px_1fr]">
          <ol className="grid content-start gap-2">
            {steps.map(([label], index) => (
              <li key={label} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-[2px] border border-border-strong font-mono text-[11px] text-text-subtle"
                >
                  {index + 1}
                </span>
                <span className="font-mono text-[12px] uppercase tracking-[0.04em] text-text-muted">
                  {label}
                </span>
              </li>
            ))}
          </ol>
          <div className="grid gap-2">
            {steps.map(([, command]) => (
              <CodeCopyRow key={command.slice(0, 24)} command={command} />
            ))}
          </div>
        </div>
        <p className="mt-5 px-1 text-[13px] leading-relaxed text-text-muted">
          Once the first event arrives, sessions and events appear in the
          project overview and the realtime view.
        </p>
      </Frame>
    </section>
  );
}

function HostedVsSelfHosted() {
  return (
    <section
      id="self-host"
      aria-label="Hosted and self-hosted"
      className="px-6 pb-16 lg:px-10 lg:pb-24"
    >
      <Frame className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-8">
          <SectionLabel prefix={null}>Hosted Prism</SectionLabel>
          <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.015em] text-text">
            Managed API and database
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
            We operate the API, storage, and WebSocket infrastructure. Create an
            account and reach your first event fastest.
          </p>
          <ul className="mt-6 grid gap-2 text-[13px] text-text-muted">
            <li>No infrastructure to operate</li>
            <li>Automatic updates and backups</li>
          </ul>
          <Link
            to="/auth/create-account"
            className="mt-8 inline-flex h-[38px] items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
          >
            Start hosted
          </Link>
        </div>
        <div className="p-8">
          <SectionLabel prefix={null}>Self-host Prism</SectionLabel>
          <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.015em] text-text">
            Your infrastructure, your data
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
            Run Prism on infrastructure you own. No Prism cloud account is
            required at any point.
          </p>
          <ul className="mt-6 grid gap-2 text-[13px] text-text-muted">
            <li>Operator-owned storage and keys</li>
            <li>Bring your own database and email provider</li>
          </ul>
          <a
            href={`${VITE_DOCS_URL}/docs/start/quickstart`}
            className="mt-8 inline-flex h-[38px] items-center rounded-[2px] border border-border-strong px-4 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
          >
            Deployment guide
          </a>
        </div>
      </Frame>
    </section>
  );
}

export function Index() {
  return (
    <div className="text-text">
      <Hero />
      <ProofBand />
      <SetupSection />
      <HostedVsSelfHosted />
    </div>
  );
}

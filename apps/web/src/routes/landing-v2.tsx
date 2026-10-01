import { language } from "@twinkleplop/typescript";
import "@twinkleplop/theme-github";
import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Copy, ExternalLink } from "@/components/ui/hugeicons";
import { useCopy } from "@/components/ui/copy-button";
import { DOCS_URL } from "@/lib/docs";
import "./landing-v2.css";

const selfHostHref = `${DOCS_URL}/docs/self-hosting/self-host-prism`;
const quickstartHref = `${DOCS_URL}/docs/start/quickstart`;
const highlightTypeScript = language();
const installCommand = "yarn add @prism-analytics/browser";
const implementationCode = `import { createBrowserClient } from "@prism-analytics/browser";

const prism = await createBrowserClient({
  sourceKey: "psk_web_your_key",
  endpoint: "https://prism-analytics-api.orekud.workers.dev",
  collection: { initialState: "granted" },
});

prism.track("checkout_started", { plan: "pro" });`;
const eventCode = `prism.track("checkout_started", {
  plan: "pro",
});`;

function Reveal({ children, className = "", delay = 0 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -32px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-visible={visible} className={`landing-reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function CodeExample({ code, label, copy = false, bare = false }: { code: string; label: string; copy?: boolean; bare?: boolean }) {
  const html = React.useMemo(() => highlightTypeScript(code), [code]);
  const { copied, onCopy } = useCopy(code);
  if (bare) {
    return (
      <div className="landing-code-inline min-w-0" aria-label={label}>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Twinkleplop emits escaped HTML from fixed, authored examples only. */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  return (
    <div className="landing-code min-w-0 overflow-hidden" aria-label={label}>
      <div className="flex h-10 items-center justify-between border-b border-border/60 px-5">
        <span className="font-mono text-[11px] text-text-subtle">example.ts</span>
        {copy ? (
          <button type="button" onClick={onCopy} aria-label={copied ? "Copied" : "Copy implementation example"}
            className="inline-flex size-8 items-center justify-center text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {/* Static, authored source only. Twinkleplop escapes code before rendering token spans. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Twinkleplop emits escaped HTML from fixed, authored examples only. */}
      <div className="landing-code-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-[1320px] px-5 pb-24 pt-24 sm:px-8 lg:pb-32 lg:pt-32">
      <div className="max-w-[1100px]">
        <Reveal>
          <h1 className="max-w-[1100px] text-[clamp(2.65rem,4.7vw,4rem)] font-semibold leading-[1.07] tracking-[-0.05em] text-text">
            Know what changed.<span className="block text-text-muted">Understand what matters.</span>
          </h1>
        </Reveal>
        <Reveal delay={60}>
          <p className="mt-7 max-w-[52ch] text-[15px] leading-[1.7] text-text-muted sm:text-[16px]">
            Product analytics, events, and errors in one place. Ask Prism about the signals behind them.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/auth/create-account"
              className="landing-cta inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full bg-text px-5 text-[13px] font-semibold text-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              Start hosted <ArrowRight size={16} aria-hidden="true" className="ml-3" />
            </Link>
            <a href={selfHostHref} target="_blank" rel="noreferrer"
              className="landing-cta inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full bg-surface-hover px-5 text-[13px] font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              Self-host Prism <ExternalLink size={16} aria-hidden="true" className="ml-3 text-text-subtle" />
            </a>
          </div>
        </Reveal>
      </div>
      <Reveal delay={160} className="mt-20 sm:mt-24">
        <figure className="overflow-hidden border border-border bg-surface-raised">
          <img src="/landing-hero.png"
            alt="Current Prism Web Analytics showing page views, visitors, sessions, a trend chart, and top pages"
            width={1179} height={804} fetchPriority="high" className="block h-auto w-full" />
        </figure>
      </Reveal>
    </section>
  );
}

function FeatureGrid() {
  return (
    <section id="product" className="mx-auto max-w-[1320px] scroll-mt-24 px-5 py-24 sm:px-8 lg:py-32">
      <Reveal>
        <h2 className="max-w-[980px] text-[clamp(2.15rem,3.6vw,3.35rem)] font-medium leading-[1.14] tracking-[-0.045em] text-text">
          A connected view of your product.
        </h2>
      </Reveal>
      <div className="landing-bento mt-14 grid gap-3 lg:grid-cols-12">
        <Reveal className="landing-bento-tile landing-bento-feature min-w-0 bg-surface-raised p-7 sm:p-9 lg:col-span-7">
          <h3 className="text-[23px] font-medium tracking-[-0.035em] text-text sm:text-[27px]">See where traffic goes.</h3>
          <p className="mt-3 max-w-[48ch] text-[14px] leading-[1.65] text-text-muted">
            Pages, referrers, and locations tied to the same project.
          </p>
          <ul className="mt-auto grid grid-cols-2 gap-y-3 pt-12 text-[13px] text-text-muted sm:grid-cols-3">
            <li>Top pages</li><li>Referrers</li><li>Locations</li>
          </ul>
        </Reveal>
        <Reveal className="landing-bento-tile landing-bento-feature min-w-0 bg-canvas-subtle p-7 sm:p-9 lg:col-span-5">
          <h3 className="text-[23px] font-medium tracking-[-0.035em] text-text sm:text-[27px]">Trace each action.</h3>
          <p className="mt-3 max-w-[39ch] text-[14px] leading-[1.65] text-text-muted">
            Read standard and custom events across web, mobile, and server sources.
          </p>
          <div className="mt-auto min-w-0 pt-10"><CodeExample code={eventCode} label="TypeScript event capture example" bare /></div>
        </Reveal>
        <Reveal className="landing-bento-tile landing-bento-feature min-w-0 bg-canvas-subtle p-7 sm:p-9 lg:col-span-5">
          <h3 className="text-[23px] font-medium tracking-[-0.035em] text-text sm:text-[27px]">Investigate errors in context.</h3>
          <p className="mt-3 max-w-[40ch] text-[14px] leading-[1.65] text-text-muted">
            Move from an issue to its occurrences, affected people, and release context.
          </p>
          <p className="mt-auto pt-12 font-mono text-[12px] text-text-subtle">Issue <span aria-hidden="true">→</span> occurrence <span aria-hidden="true">→</span> affected person</p>
        </Reveal>
        <Reveal className="landing-bento-tile landing-bento-feature min-w-0 bg-surface-raised p-7 sm:p-9 lg:col-span-7">
          <h3 className="text-[23px] font-medium tracking-[-0.035em] text-text sm:text-[27px]">Ask Prism what changed.</h3>
          <p className="mt-3 max-w-[48ch] text-[14px] leading-[1.65] text-text-muted">
            Answers linked to measured facts and the activity behind them.
          </p>
          <div className="mt-auto max-w-[38ch] pt-10 text-[14px] leading-relaxed">
            <p className="text-text">“What changed after the latest release?”</p>
            <p className="mt-2 text-text-muted">
              Signups up 12% week-over-week, driven by <span className="text-text">onboarding_completed</span>.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function InstallStep() {
  const { copied, onCopy } = useCopy(installCommand);
  return (
    <div className="setup-step-content">
      <p className="landing-feature-index">01 / Install</p>
      <h3 className="mt-5 text-[24px] font-medium tracking-[-0.035em] text-text sm:text-[30px]">Add the Browser SDK.</h3>
      <p className="mt-3 max-w-[43ch] text-[14px] leading-[1.7] text-text-muted">Start with a web source key from your Prism project.</p>
      <div className="landing-install-row mt-10 flex min-w-0 items-center gap-4 px-5 py-4">
        <span aria-hidden="true" className="font-mono text-text-subtle">$</span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-text">{installCommand}</code>
        <button type="button" onClick={onCopy} aria-label={copied ? "Copied" : "Copy install command"}
          className="grid size-8 shrink-0 place-items-center text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function ImplementStep() {
  return (
    <div className="setup-step-content">
      <p className="landing-feature-index">02 / Implement</p>
      <h3 className="mt-5 text-[24px] font-medium tracking-[-0.035em] text-text sm:text-[30px]">Send your first event.</h3>
      <p className="mt-3 max-w-[43ch] text-[14px] leading-[1.7] text-text-muted">Initialize the SDK, then verify the event on your project’s Events page.</p>
      <div className="mt-7"><CodeExample code={implementationCode} label="Browser SDK implementation example" copy /></div>
    </div>
  );
}

function SetupSection() {
  return (
    <section className="setup-scroll">
      <div className="setup-inner mx-auto grid max-w-[1320px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-32">
        <div className="setup-intro">
          <Reveal>
            <h2 className="max-w-[12ch] text-[clamp(2.15rem,3.5vw,3.3rem)] font-medium leading-[1.12] tracking-[-0.045em] text-text">
              From install to first signal.
            </h2>
            <a href={quickstartHref} target="_blank" rel="noreferrer"
              className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-text underline decoration-border-strong underline-offset-4 hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
              Read the quickstart <ExternalLink size={14} aria-hidden="true" />
            </a>
          </Reveal>
        </div>
        <div className="setup-stages min-w-0">
          <div className="setup-stage" data-setup-stage="install">
            <InstallStep />
          </div>
          <div className="setup-stage" data-setup-stage="implement">
            <ImplementStep />
          </div>
        </div>
      </div>
    </section>
  );
}

function DeploymentSection() {
  return (
    <section id="self-host" className="scroll-mt-20 border-t border-border py-24 lg:py-32">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <Reveal><h2 className="max-w-[15ch] text-[clamp(2.15rem,3.5vw,3.35rem)] font-medium leading-[1.12] tracking-[-0.045em] text-text">Run Prism your way.</h2></Reveal>
        <div className="mt-16 grid gap-16 md:grid-cols-2 lg:gap-28">
          <Reveal>
            <h3 className="text-[20px] font-medium tracking-[-0.025em] text-text">Hosted Prism</h3>
            <p className="mt-4 max-w-[42ch] text-[15px] leading-[1.7] text-text-muted">We operate the API and storage.</p>
            <Link to="/auth/create-account"
              className="mt-4 inline-block text-[13px] font-medium text-text underline decoration-border-strong underline-offset-4 hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
              Start hosted
            </Link>
          </Reveal>
          <Reveal>
            <h3 className="text-[20px] font-medium tracking-[-0.025em] text-text">Self-host Prism</h3>
            <p className="mt-4 max-w-[42ch] text-[15px] leading-[1.7] text-text-muted">Run Prism on your own infrastructure.</p>
            <a href={selfHostHref} target="_blank" rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text underline decoration-border-strong underline-offset-4 hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
              Read the self-hosting guide <ExternalLink size={14} aria-hidden="true" />
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Index() {
  return (
    <div className="landing-page bg-canvas text-text">
      <Hero />
      <FeatureGrid />
      <SetupSection />
      <DeploymentSection />
    </div>
  );
}

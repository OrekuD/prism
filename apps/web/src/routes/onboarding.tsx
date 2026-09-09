import { AlertCircle, Check, Copy, Loader2, PartyPopper } from "@/components/ui/lucide-icons";
import React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Frame, SectionLabel } from "@/components/public/frame";
import { PrismMark } from "@/components/brand/prism-mark";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { useCopy } from "@/components/ui/copy-button";
import { authClient } from "@/lib/authClient";
import { waitForSession } from "@/lib/session";
import { loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtimeConfig";
import { OwnerSetup } from "@/components/onboarding/owner-setup";
import {
  completeOnboarding,
  createFirstProject,
  fetchProjectEvents,
  fetchProjectForOnboarding,
  isOnboardingComplete,
  loadProgress,
  saveProgress,
} from "@/lib/onboarding";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { TELEMETRY_EVENTS, trackTelemetry } from "@/lib/telemetry";
import { useCurrentWorkspace } from "@/lib/workspace";
import { createFirstSource } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const BASE_STEPS = [
  "Profile",
  "Workspace",
  "Project",
  "Install SDK",
  "Verify first event",
  "Done",
] as const;

const INSTANCE_STEP = "Instance configuration" as const;

/** Redacted display form of a project key. */
function maskKey(key: string): string {
  if (key.length <= 10) return "pr_***";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

type StepState = "done" | "current" | "waiting";

function Checklist({ current, steps }: { current: number; steps: readonly string[] }) {
  const states: Array<StepState> = steps.map((_, index) =>
    index + 1 < current ? "done" : index + 1 === current ? "current" : "waiting",
  );
  return (
    <div className="grid gap-3">
      <SectionLabel prefix={null}>
        Progress <span className="text-text-subtle">{Math.min(current, 6)} of 6</span>
      </SectionLabel>
      <ol className="grid gap-1.5">
        {steps.map((label, index) => {
          const state = states[index];
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2.5 text-[12px]",
                state === "done" && "text-text-muted",
                state === "current" && "text-text",
                state === "waiting" && "text-text-subtle",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 place-items-center rounded-full border",
                  state === "done" && "border-success text-success",
                  state === "current" && "border-accent text-accent",
                  state === "waiting" && "border-border-strong text-text-subtle",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3" />
                ) : state === "current" ? (
                  <span className="size-1.5 rounded-full bg-accent" />
                ) : (
                  index + 1
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Onboarding() {
  const navigate = useNavigate();
  const { data: sessionData } = authClient.useSession();
  const { workspace } = useCurrentWorkspace();
  const projectsQuery = useProjectsQuery();
  const [config, setConfig] = React.useState<RuntimeConfig | null>(null);

  React.useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  // Self-hosted instances prepend an instance-configuration step.
  const selfHosted = config?.deploymentMode === "self-hosted";
  const steps = React.useMemo(
    () => (selfHosted ? [INSTANCE_STEP, ...BASE_STEPS] : BASE_STEPS),
    [selfHosted],
  );
  // 1-based offset: self-hosted flows start at the instance step.
  const offset = selfHosted ? 1 : 0;

  const [progress, setProgress] = React.useState(() => loadProgress());
  const step = progress?.step ?? (selfHosted ? 1 : 1);

  const [projectName, setProjectName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [keyConfirmed, setKeyConfirmed] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [firstEvent, setFirstEvent] = React.useState(false);

  const advance = (next: number) => {
    const updated = { ...(progress ?? {}), step: next };
    setProgress(updated);
    saveProgress(updated);
    trackTelemetry(TELEMETRY_EVENTS.onboardingStep, { step: next });
  };

  // Resume: a saved project means steps 4-6 are re-enterable.
  const projectSlug = progress?.projectSlug;

  const onCreateProject = async () => {
    if (isCreating) return;
    setCreateError(null);
    setIsCreating(true);
    try {
      if (!workspace) throw new Error("No workspace found.");
      const project = await createFirstProject(workspace.id, projectName.trim());
      // Task 13: the project's first source creates the publishable key
      // that the install snippet uses.
      const source = await createFirstSource(project.slug, "Web");
      const detail = await fetchProjectForOnboarding(project.slug);
      const updated = {
        step: 4 + offset,
        projectId: project.id,
        projectSlug: project.slug,
        apiKey: source.initialKey ?? undefined,
      };
      setProgress(updated);
      saveProgress(updated);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Could not create the project.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  // Copy feedback is shared app-wide (icon flips to a success check).
  const { copied: keyCopied, onCopy: onCopyKey } = useCopy(progress?.apiKey ?? "");
  const handleCopyKey = () => {
    if (!progress?.apiKey) return;
    void onCopyKey();
  };

  const onVerify = React.useCallback(async () => {
    if (verifying || !projectSlug) return;
    setVerifying(true);
    try {
      const events = await fetchProjectEvents(projectSlug);
      if (events.length > 0) {
        setFirstEvent(true);
        trackTelemetry(TELEMETRY_EVENTS.firstEventSuccess, {});
        const updated = { ...(progress ?? {}), step: 6 + offset };
        setProgress(updated);
        saveProgress(updated);
      }
    } catch {
      // Transient poll failure: keep waiting, the user can retry.
    } finally {
      setVerifying(false);
    }
  }, [verifying, projectSlug, progress, offset]);

  React.useEffect(() => {
    if (step !== 5 + offset || firstEvent || !projectSlug) return;
    const timer = window.setInterval(onVerify, 4000);
    return () => window.clearInterval(timer);
  }, [step, firstEvent, projectSlug, onVerify, offset]);

  if (selfHosted && config?.setupRequired && !sessionData?.session) {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-10 md:px-6 md:py-12">
        <PrismMark size={36} decorative />
        <div className="mt-6">
          <SectionLabel>First boot</SectionLabel>
        </div>
        <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.025em] text-text">
          Set up {config.instanceName}
        </h1>
        <p className="mt-2 max-w-[60ch] text-[14px] text-text-muted">
          Create the first local owner account, then connect your first
          project. Everything runs on this instance.
        </p>
        <div className="mt-8">
          <OwnerSetup
            onComplete={() => {
              // The owner is signed in; enter the product shell once the
              // router sees the session (same race as post-signup).
              waitForSession().then(() => navigate("/onboarding"));
            }}
          />
        </div>
      </div>
    );
  }

  if (!sessionData?.session) {
    // Anonymous visitors only reach this page through /setup (first
    // boot). Wait for the runtime config before redirecting: the
    // OwnerSetup branch above depends on it, and a premature redirect
    // would make the first-boot UI unreachable.
    if (!config) {
      return (
        <div className="mx-auto grid w-full max-w-[1500px] place-items-center px-4 py-24">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </div>
      );
    }
    return <Navigate to="/auth/log-in" />;
  }
  if (
    isOnboardingComplete(6 + offset) ||
    (projectsQuery.data && projectsQuery.data.length > 0)
  ) {
    return <Navigate to="/projects" />;
  }

  const email = sessionData.user.email;
  const name = sessionData.user.name;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-10 md:px-6 md:py-12">
      <SectionLabel>Get started</SectionLabel>
      <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.025em] text-text">
        Connect your first project
      </h1>
      <p className="mt-2 max-w-[60ch] text-[14px] text-text-muted">
        Confirm your profile, create a project, install the SDK, and verify the
        first event.
      </p>

      <Frame className="mt-8 min-h-[520px]">
        {/* Rows fill the frame: mobile = steps auto + aside 1fr; desktop =
            one stretched row so both columns reach full height. */}
        <div className="grid min-h-[520px] grid-rows-[auto_1fr] md:grid-cols-[58fr_42fr] md:grid-rows-1">
          <div className="border-b border-border p-6 sm:p-8 md:border-b-0 md:border-r">
            {/* Self-hosted step 1: instance configuration confirmation */}
            {selfHosted && step === 1 && config ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Instance configuration
                  </h2>
                  <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-text-muted">
                    Confirm how this instance is set up. Settings live in the
                    deployment environment; changing them requires an operator
                    update and restart.
                  </p>
                </div>
                <dl className="grid gap-4 text-[14px]">
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Instance name
                    </dt>
                    <dd className="text-text">{config.instanceName}</dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Public URL
                    </dt>
                    <dd className="text-[13px] text-text">
                      {config.baseUrl}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Registration policy
                    </dt>
                    <dd className="text-text">
                      {config.signupPolicy === "open"
                        ? "Open"
                        : config.signupPolicy === "invite-only"
                          ? "Invite only"
                          : "Disabled"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Email provider
                    </dt>
                    <dd className="text-text">
                      {config.mailConfigured ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Social providers
                    </dt>
                    <dd className="text-text">
                      {config.providers.github || config.providers.google
                        ? ["github", "google"]
                            .filter((name) =>
                              config.providers[name as "github" | "google"],
                            )
                            .map((name) => name[0].toUpperCase() + name.slice(1))
                            .join(", ")
                        : "None"}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => advance(2)}
                  className="inline-flex h-10 w-fit items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                >
                  Looks right, continue
                </button>
              </div>
            ) : null}

            {/* Step 1 (hosted) / 2 (self-hosted): profile */}
            {step === 1 + offset ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Confirm your profile
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    Your workspace is created from these details.
                  </p>
                </div>
                <dl className="grid gap-4 text-[14px]">
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Name
                    </dt>
                    <dd className="text-text">{name}</dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Email
                    </dt>
                    <dd className="text-text">{email}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => advance(2 + offset)}
                  className="inline-flex h-10 w-fit items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                >
                  Looks good, continue
                </button>
              </div>
            ) : null}

            {/* Step 2 (hosted) / 3 (self-hosted): workspace */}
            {step === 2 + offset ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Your workspace
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    A personal workspace was created for your account.
                  </p>
                </div>
                <dl className="grid gap-4 text-[14px]">
                  <div className="grid gap-1">
                    <dt className="text-[11px] tracking-normal text-text-subtle">
                      Workspace
                    </dt>
                    <dd className="text-text">
                      {workspace?.name ?? "Personal workspace"}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => advance(3 + offset)}
                  className="inline-flex h-10 w-fit items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                >
                  Continue
                </button>
              </div>
            ) : null}

            {/* Step 3 (hosted) / 4 (self-hosted): create project + key */}
            {step === 3 + offset ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Create your first project
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    Projects group sessions and events under one analytics key.
                  </p>
                </div>
                <div className="grid gap-2">
                  <label
                    htmlFor="project-name"
                    className="text-[13px] font-medium text-text"
                  >
                    Project name
                  </label>
                  <input
                    id="project-name"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="My product"
                    autoComplete="off"
                    className="h-10 rounded-[10px] border border-border-strong bg-surface px-3 text-[14px] text-text placeholder:text-text-subtle focus:border-focus focus:outline-2 focus:outline-offset-2 focus:outline-focus"
                  />
                </div>
                {createError ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-[12px] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-text"
                  >
                    <AlertCircle
                      className="mt-0.5 size-4 shrink-0 text-danger"
                      aria-hidden="true"
                    />
                    <span>{createError}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={onCreateProject}
                  disabled={isCreating || projectName.trim().length === 0}
                  aria-busy={isCreating}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover disabled:opacity-45"
                >
                  {isCreating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Create project
                </button>
              </div>
            ) : null}

            {/* Step 4 (hosted) / 5 (self-hosted): key + install */}
            {step === 4 + offset && progress?.apiKey ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Save your analytics key
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    Shown once. Copy it now, then install the SDK.
                  </p>
                </div>
                <div className="flex h-[42px] items-stretch bg-surface-raised">
                  <code className="flex flex-1 items-center overflow-x-auto px-3 text-[13px] text-text">
                    {progress.apiKey}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    aria-label={keyCopied ? "Copied" : "Copy project key"}
                    aria-live="polite"
                    className="grid w-9 shrink-0 place-items-center border-l border-border text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                  >
                    {keyCopied ? (
                      <Check className="size-4 text-success" aria-hidden="true" />
                    ) : (
                      <Copy className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <label className="flex w-fit items-center gap-2.5 text-[13px] text-text-muted">
                  <input
                    type="checkbox"
                    checked={keyConfirmed}
                    onChange={(event) => setKeyConfirmed(event.target.checked)}
                    className="size-4 accent-accent"
                  />
                  I've saved the key somewhere safe
                </label>
                <button
                  type="button"
                  onClick={() => {
                    // Step 5; the key is no longer shown in full after this.
                    const updated = { ...progress, step: 5 + offset, apiKey: undefined };
                    setProgress(updated);
                    saveProgress(updated);
                  }}
                  disabled={!keyConfirmed}
                  className="inline-flex h-10 w-fit items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover disabled:opacity-45"
                >
                  Install the SDK
                </button>
              </div>
            ) : null}

            {/* Step 5 (hosted) / 6 (self-hosted): verify first event */}
            {step === 5 + offset && projectSlug ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Verify your first event
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    Run this from your app (or a browser console) with the
                    project key you saved:
                  </p>
                </div>
                <div className="grid gap-2">
                  <CodeCopyRow command="yarn add @prism-analytics/core @prism-analytics/browser" />
                  <CodeCopyRow
                    command={`const prism = await createBrowserClient({
  sourceKey: "psk_…",
  endpoint: window.location.origin,
  collection: { initialState: "granted" },
});`}
                  />
                  <CodeCopyRow
                    command={`prism.track("app_opened", { source: "onboarding" });`}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      firstEvent ? "bg-success" : "bg-warning",
                    )}
                  />
                  <p className="text-[13px] text-text-muted">
                    {firstEvent
                      ? "First event received."
                      : "Waiting for the first event…"}
                  </p>
                  <button
                    type="button"
                    onClick={onVerify}
                    disabled={verifying}
                    aria-busy={verifying}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-border-strong px-3 text-[12px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover disabled:opacity-45"
                  >
                    {verifying ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Check now
                  </button>
                </div>
              </div>
            ) : null}

            {/* Step 6 (hosted) / 7 (self-hosted): done */}
            {step === 6 + offset && projectSlug ? (
              <div className="grid gap-6">
                <div className="flex items-center gap-3">
                  <PartyPopper className="size-5 text-success" aria-hidden="true" />
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Your project is live
                  </h2>
                </div>
                <p className="text-[14px] leading-relaxed text-text-muted">
                  Sessions and events now flow into the project overview and the
                  realtime view.
                </p>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/projects/${projectSlug}`}
                    className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                  >
                    Open project overview
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      completeOnboarding();
                      navigate("/projects");
                    }}
                    className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right status column */}
          <aside className="flex flex-col bg-canvas-subtle p-6 sm:p-8">
            <Checklist current={step} steps={steps} />
            {step < 6 + offset ? (
              <button
                type="button"
                onClick={() => {
                  completeOnboarding();
                  navigate("/projects");
                }}
                className="mt-8 text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
              >
                Skip for now
              </button>
            ) : null}
          </aside>
        </div>
      </Frame>
    </div>
  );
}

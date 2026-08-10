import { Check, Copy, Loader2, PartyPopper } from "lucide-react";
import React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Frame, SectionLabel } from "@/components/public/frame";
import { CodeCopyRow } from "@/components/public/code-copy-row";
import { authClient } from "@/lib/authClient";
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
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { cn } from "@/lib/utils";

const STEPS = [
  "Profile",
  "Workspace",
  "Project",
  "Install SDK",
  "Verify first event",
  "Done",
] as const;

/** Redacted display form of a project key. */
function maskKey(key: string): string {
  if (key.length <= 10) return "pr_***";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

type StepState = "done" | "current" | "waiting";

function Checklist({ current }: { current: number }) {
  const states: Array<StepState> = STEPS.map((_, index) =>
    index + 1 < current ? "done" : index + 1 === current ? "current" : "waiting",
  );
  return (
    <div className="grid gap-3">
      <SectionLabel prefix={null}>
        Progress <span className="text-text-subtle">{Math.min(current, 6)} of 6</span>
      </SectionLabel>
      <ol className="grid gap-1.5">
        {STEPS.map((label, index) => {
          const state = states[index];
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2.5 font-mono text-[12px]",
                state === "done" && "text-text-muted",
                state === "current" && "text-text",
                state === "waiting" && "text-text-subtle",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 place-items-center rounded-[2px] border",
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
  const teamsQuery = useTeamsQuery();
  const projectsQuery = useProjectsQuery();

  const [progress, setProgress] = React.useState(() => loadProgress());
  const step = progress?.step ?? 1;

  const [projectName, setProjectName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [keyCopied, setKeyCopied] = React.useState(false);
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
      const team = teamsQuery.data?.find((entry) => entry.isPersonal);
      if (!team) throw new Error("No personal team found.");
      const project = await createFirstProject(team.id, projectName.trim());
      const detail = await fetchProjectForOnboarding(project.slug);
      const updated = {
        step: 4,
        projectId: project.id,
        projectSlug: project.slug,
        apiKey: detail.apiKey ?? undefined,
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

  const onCopyKey = async () => {
    if (!progress?.apiKey) return;
    try {
      await navigator.clipboard.writeText(progress.apiKey);
      setKeyCopied(true);
      window.setTimeout(() => setKeyCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the key stays visible until confirmed.
    }
  };

  const onVerify = React.useCallback(async () => {
    if (verifying || !projectSlug) return;
    setVerifying(true);
    try {
      const events = await fetchProjectEvents(projectSlug);
      if (events.length > 0) {
        setFirstEvent(true);
        trackTelemetry(TELEMETRY_EVENTS.firstEventSuccess, {});
        const updated = { ...(progress ?? {}), step: 6 };
        setProgress(updated);
        saveProgress(updated);
      }
    } catch {
      // Transient poll failure: keep waiting, the user can retry.
    } finally {
      setVerifying(false);
    }
  }, [verifying, projectSlug, progress]);

  React.useEffect(() => {
    if (step !== 5 || firstEvent || !projectSlug) return;
    const timer = window.setInterval(onVerify, 4000);
    return () => window.clearInterval(timer);
  }, [step, firstEvent, projectSlug, onVerify]);

  if (!sessionData?.session) {
    return <Navigate to="/auth/log-in" />;
  }
  if (isOnboardingComplete() || (projectsQuery.data && projectsQuery.data.length > 0)) {
    return <Navigate to="/projects" />;
  }

  const email = sessionData.user.email;
  const name = sessionData.user.name;
  const personalTeam = teamsQuery.data?.find((entry) => entry.isPersonal);

  return (
    <div className="mx-auto max-w-[1120px] px-4 py-10 md:px-6 md:py-12">
      <SectionLabel>Get started</SectionLabel>
      <h1 className="mt-3 font-mono text-[26px] font-semibold tracking-[-0.025em] text-text">
        Connect your first project
      </h1>
      <p className="mt-2 max-w-[60ch] text-[14px] text-text-muted">
        Confirm your profile, create a project, install the SDK, and verify the
        first event.
      </p>

      <Frame className="mt-8 min-h-[520px]">
        <div className="grid md:grid-cols-[58fr_42fr]">
          <div className="border-b border-border p-6 sm:p-8 md:border-b-0 md:border-r">
            {/* Step 1: profile */}
            {step === 1 ? (
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
                    <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-subtle">
                      Name
                    </dt>
                    <dd className="text-text">{name}</dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-subtle">
                      Email
                    </dt>
                    <dd className="text-text">{email}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => advance(2)}
                  className="inline-flex h-10 w-fit items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                >
                  Looks good, continue
                </button>
              </div>
            ) : null}

            {/* Step 2: workspace */}
            {step === 2 ? (
              <div className="grid gap-6">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-text">
                    Your workspace
                  </h2>
                  <p className="mt-1.5 text-[13px] text-text-muted">
                    A personal team was created for your account.
                  </p>
                </div>
                <dl className="grid gap-4 text-[14px]">
                  <div className="grid gap-1">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-text-subtle">
                      Team
                    </dt>
                    <dd className="text-text">
                      {personalTeam?.name ?? "Personal team"}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => advance(3)}
                  className="inline-flex h-10 w-fit items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                >
                  Continue
                </button>
              </div>
            ) : null}

            {/* Step 3: create project + key */}
            {step === 3 ? (
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
                    className="h-10 rounded-[2px] border border-border-strong bg-surface px-3 text-[14px] text-text placeholder:text-text-subtle focus:border-focus focus:outline-2 focus:outline-offset-2 focus:outline-focus"
                  />
                </div>
                {createError ? (
                  <p className="text-[13px] text-danger" role="alert">
                    {createError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={onCreateProject}
                  disabled={isCreating || projectName.trim().length === 0}
                  aria-busy={isCreating}
                  className="inline-flex h-10 w-fit items-center gap-2 rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover disabled:opacity-45"
                >
                  {isCreating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Create project
                </button>
              </div>
            ) : null}

            {/* Step 4: key + install */}
            {step === 4 && progress?.apiKey ? (
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
                  <code className="flex flex-1 items-center overflow-x-auto px-3 font-mono text-[13px] text-text">
                    {progress.apiKey}
                  </code>
                  <button
                    type="button"
                    onClick={onCopyKey}
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
                    const updated = { ...progress, step: 5, apiKey: undefined };
                    setProgress(updated);
                    saveProgress(updated);
                  }}
                  disabled={!keyConfirmed}
                  className="inline-flex h-10 w-fit items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover disabled:opacity-45"
                >
                  Install the SDK
                </button>
              </div>
            ) : null}

            {/* Step 5: verify first event */}
            {step === 5 && projectSlug ? (
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
                  <CodeCopyRow command="yarn add @prism/core" />
                  <CodeCopyRow
                    command={`const prism = new PrismClient("pr_…")`}
                  />
                  <CodeCopyRow
                    command={`await prism.logEvent("app_opened", { source: "onboarding" })`}
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
                    className="inline-flex h-8 items-center gap-2 rounded-[2px] border border-border-strong px-3 text-[12px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover disabled:opacity-45"
                  >
                    {verifying ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Check now
                  </button>
                </div>
              </div>
            ) : null}

            {/* Step 6: done */}
            {step === 6 && projectSlug ? (
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
                    className="inline-flex h-10 items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
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
          <aside className="bg-canvas-subtle p-6 sm:p-8">
            <Checklist current={step} />
            {step < 6 ? (
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

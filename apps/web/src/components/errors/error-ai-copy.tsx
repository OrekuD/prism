"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  ErrorIssueDetailResource,
  ErrorIssueResource,
} from "@prism-analytics/types";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Sparkles,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";

/**
 * Build LLM-ready markdown for an error issue.
 * Mirrors the drawer in analytics-dashboard-v2.html
 * but as copy-pasteable markdown for an LLM.
 *
 * Sensitive values are already redacted by ingestion (errorSanitize),
 * so this only ever copies sanitized, visible text.
 */
export function buildErrorMarkdown(
  issue: ErrorIssueResource,
  detail: ErrorIssueDetailResource | null | undefined,
  _projectSlug?: string
): string {
  const fmt = new Intl.NumberFormat();
  const iso = (ts: number) => {
    try {
      return new Date(ts).toISOString();
    } catch {
      return String(ts);
    }
  };
  const latest = detail?.occurrences?.[0];
  const occurrences = detail?.occurrences ?? [];
  const activity = detail?.activity ?? [];

  const stackText = latest
    ? [
        `${latest.exception.type}: ${latest.exception.message ?? ""}`.trim(),
        ...latest.exception.frames.map((f) => {
          const fn = f.function ? `at ${f.function}` : "at <anonymous>";
          const rawFile = f.file?.startsWith("null/")
            ? f.file.slice(4)
            : f.file;
          const loc =
            rawFile && f.line !== null
              ? ` (${rawFile}:${f.line}${f.column !== null ? `:${f.column}` : ""})`
              : rawFile
                ? ` (${rawFile})`
                : "";
          return `  ${fn}${loc}`;
        }),
      ].join("\n")
    : "_No stack frames captured._";

  const lines: string[] = [];

  lines.push("Fix this error:");
  lines.push("");
  lines.push(
    "Diagnose the root cause and propose a minimal fix. Reference exact file:line and keep the change focused."
  );
  lines.push("");
  lines.push("## Error");
  lines.push(`- **Title:** \`${issue.title}\``);
  lines.push(`- **Location:** \`${issue.location ?? "unknown"}\``);
  lines.push(
    `- **Status:** ${issue.status} · **Level:** ${issue.level} · **Platform:** ${issue.platform}`
  );
  lines.push(`- **Seen:** ${iso(issue.firstSeen)} → ${iso(issue.lastSeen)}`);
  lines.push(
    `- **Counts:** ${fmt.format(issue.count)} events · ${fmt.format(issue.users)} users in range${detail ? ` · all-time ${fmt.format(detail.occurrenceCountAll)} / ${fmt.format(detail.usersAffectedAll)} users` : ""}`
  );
  if (detail?.firstRelease || detail?.lastRelease) {
    lines.push(
      `- **Releases:** ${detail.firstRelease ?? "—"} → ${detail.lastRelease ?? "—"}`
    );
  }
  if (latest) {
    lines.push(
      `- **Latest:** ${latest.environment ?? "—"} · \`${latest.release ?? "—"}\` · ${latest.handled ? "handled" : "unhandled"}`
    );
  }
  lines.push("");
  lines.push(
    `## Stack trace${latest ? ` (${latest.exception.frames.length} frames, sanitized, raw)` : ""}`
  );
  lines.push("");
  lines.push("```js");
  lines.push(stackText);
  if (latest?.exception.hasCause) {
    lines.push("");
    lines.push("// has nested cause — redacted");
  }
  lines.push("```");
  lines.push("");
  if (latest) {
    lines.push(`## Occurrence \`${latest.id.slice(0, 8)}\``);
    lines.push(
      `- **When:** ${iso(latest.occurredAt)} (received ${iso(latest.receivedAt)})`
    );
    lines.push(
      `- **Handled:** ${latest.handled ? "handled" : "unhandled"} · **Level:** ${latest.level}`
    );
    lines.push(
      `- **Breadcrumbs:** ${latest.breadcrumbsCount} (sanitized, no bodies/headers/cookies)`
    );
    lines.push(
      `- **Context:** tags=${latest.tagsCount}, extras=${latest.extrasCount} (values redacted)`
    );
    lines.push("");
  }
  if (occurrences.length > 1) {
    lines.push(
      `## Recent occurrences (most recent ${Math.min(occurrences.length, 8)}${detail?.hasMoreOccurrences ? ", more available" : ""})`
    );
    for (const o of occurrences.slice(0, 8)) {
      lines.push(
        `- \`${o.id.slice(0, 8)}\` · ${o.exception.type} · ${o.handled ? "handled" : "unhandled"} · ${o.release ?? "—"} · ${o.environment ?? "—"} · ${iso(o.receivedAt)}`
      );
    }
    lines.push("");
  }
  if (activity.length > 0) {
    lines.push("## Workflow");
    for (const a of activity) {
      lines.push(
        `- ${a.action}: ${a.priorState} → ${a.newState} at ${iso(a.timestamp)}${a.actorType === "member" && a.actorId ? ` (by ${a.actorId.slice(0, 8)})` : ""}${a.note ? ` — ${a.note}` : ""}`
      );
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "_Sensitive values have been redacted. Provide a minimal, focused fix for the error above._"
  );
  return lines.join("\n");
}

export function buildErrorJson(
  issue: ErrorIssueResource,
  detail: ErrorIssueDetailResource | null | undefined
) {
  return JSON.stringify(
    {
      issue: {
        id: issue.id,
        title: issue.title,
        fingerprint: issue.fingerprint,
        platform: issue.platform,
        level: issue.level,
        status: issue.status,
        location: issue.location,
        delta: issue.delta,
        count: issue.count,
        users: issue.users,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
      },
      detail: detail
        ? {
            occurrenceCountAll: detail.occurrenceCountAll,
            usersAffectedAll: detail.usersAffectedAll,
            firstRelease: detail.firstRelease,
            lastRelease: detail.lastRelease,
            occurrences: detail.occurrences.map((o) => ({
              id: o.id,
              occurredAt: o.occurredAt,
              receivedAt: o.receivedAt,
              level: o.level,
              handled: o.handled,
              release: o.release,
              environment: o.environment,
              exception: o.exception,
              tagsCount: o.tagsCount,
              extrasCount: o.extrasCount,
              breadcrumbsCount: o.breadcrumbsCount,
            })),
            activity: detail.activity,
            hasMoreOccurrences: detail.hasMoreOccurrences,
          }
        : null,
    },
    null,
    2
  );
}

function useCopyWithFeedback(value: string) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied for AI — paste into your agent");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }, [value]);
  return { copied, onCopy };
}

export function ErrorAICopyButton({
  issue,
  detail,
  projectSlug,
  className,
}: {
  issue: ErrorIssueResource;
  detail?: ErrorIssueDetailResource | null;
  projectSlug?: string;
  className?: string;
}) {
  const markdown = React.useMemo(
    () => buildErrorMarkdown(issue, detail, projectSlug),
    [issue, detail, projectSlug]
  );
  const { copied, onCopy } = useCopyWithFeedback(markdown);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label={copied ? "Copied for AI" : "Copy for AI"}
      className={cn(
        "gap-2 [&_svg]:size-3.5",
        copied &&
          "border-success/50 text-success hover:bg-success/10 hover:text-success",
        className
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
      {copied ? "Copied" : "Copy for AI"}
    </Button>
  );
}

export function ErrorAICopyPopover({
  issue,
  detail,
  projectSlug,
}: {
  issue: ErrorIssueResource;
  detail?: ErrorIssueDetailResource | null;
  projectSlug?: string;
}) {
  const markdown = React.useMemo(
    () => buildErrorMarkdown(issue, detail, projectSlug),
    [issue, detail, projectSlug]
  );
  const json = React.useMemo(
    () => buildErrorJson(issue, detail),
    [issue, detail]
  );
  const { copied: copiedMd, onCopy: onCopyMd } = useCopyWithFeedback(markdown);
  const { copied: copiedJson, onCopy: onCopyJson } = useCopyWithFeedback(json);

  const llmPrompt = React.useMemo(() => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    // markdown already starts with "Fix this error:" so just append source
    return `${markdown}\n\nSource: ${url}`;
  }, [markdown]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2">
          <ChevronDown className="size-3.5" aria-hidden />
          <span className="sr-only">More copy options</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onCopyMd}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            {copiedMd ? (
              <Check className="size-4 text-success" />
            ) : (
              <FileText className="size-4" />
            )}
            Copy as Markdown
          </button>
          <button
            type="button"
            onClick={onCopyJson}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            {copiedJson ? (
              <Check className="size-4 text-success" />
            ) : (
              <FileJson className="size-4" />
            )}
            Copy as JSON
          </button>
          <a
            href={`https://chatgpt.com/?hints=search&q=${encodeURIComponent(llmPrompt.slice(0, 8000))}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="size-4" />
            Open in ChatGPT
          </a>
          <a
            href={`https://claude.ai/new?q=${encodeURIComponent(llmPrompt.slice(0, 6000))}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="size-4" />
            Open in Claude
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ErrorPageActions({
  issue,
  detail,
  projectSlug,
}: {
  issue: ErrorIssueResource;
  detail?: ErrorIssueDetailResource | null;
  projectSlug?: string;
}) {
  return (
    <div className="prism-page-actions flex flex-row flex-wrap items-center gap-2 border-b border-border pb-6">
      <ErrorAICopyButton
        issue={issue}
        detail={detail}
        projectSlug={projectSlug}
      />
      <ErrorAICopyPopover
        issue={issue}
        detail={detail}
        projectSlug={projectSlug}
      />
    </div>
  );
}

import type React from "react";
import { cn } from "@/lib/utils";

/**
 * v2 page header — monospace title + muted subtitle, with an optional
 * right-aligned action slot. The single canonical title section for every
 * workspace/project page (matches overview, members, projects, and
 * create-project). Pages that need an action (Create, Invite, Delete …)
 * pass it as children and it sits on the right.
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

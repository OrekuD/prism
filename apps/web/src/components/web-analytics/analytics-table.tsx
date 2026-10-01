import { cn } from "@/lib/utils";
import type * as React from "react";

export function AnalyticsTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-auto rounded-[16px] border border-border", className)}>
      <table className="w-full border-collapse font-sans text-[13px]">{children}</table>
    </div>
  );
}

export function AnalyticsTableHead({ children }: { children: React.ReactNode }) {
  return <thead>{children}</thead>;
}

export function AnalyticsTableHeaderRow({ children }: { children: React.ReactNode }) {
  return <tr>{children}</tr>;
}

export function AnalyticsTableHeaderCell({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-border bg-canvas-subtle px-4 py-2.5 text-[13px] font-medium tracking-normal text-text-subtle",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

export function AnalyticsTableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function AnalyticsTableRow({
  children,
  selected,
}: {
  children: React.ReactNode;
  selected?: boolean;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-surface-hover", selected && "bg-accent-soft")}>
      {children}
    </tr>
  );
}

export function AnalyticsTableCell({
  children,
  align = "left",
  mono,
  subtle,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  subtle?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3.5 py-2.5",
        align === "right" && "text-right tabular-nums",
        mono && "font-mono",
        subtle && "text-text-subtle",
      )}
    >
      {children}
    </td>
  );
}

// Helper for the two-line first column (path + title/host) used in Pages
export function PageCellMain({ path, title, host }: { path: string; title?: string | null; host?: string | null }) {
  return (
    <>
      <b className="block truncate text-[12.5px] font-medium leading-[1.35] tabular-nums">{path}</b>
      <span className="block truncate text-[11px] text-text-muted">
        {title ?? ""}
        {host ? ` · ${host}` : ""}
      </span>
    </>
  );
}

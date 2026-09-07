/**
 * Shared primitives for the project overview v2 design
 * (replica of `prism-project-overview-v2.html`, Tailwind edition).
 *
 * Every visual atom lives here: framed surfaces with corner registration
 * marks, section labels, tags, chips, buttons, and the segmented control.
 * Color, type, and radius resolve through the app theme tokens, so both
 * themes follow the sidebar toggle automatically.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Uppercase mono section heading with an optional right-aligned note. */
export function SectionLabel({
  children,
  right,
  id,
}: {
  children: ReactNode;
  right?: ReactNode;
  id?: string;
}) {
  return (
    <div
      className="mb-3 mt-9 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase leading-[1.3] tracking-[0.09em] text-text-muted"
      data-od-id={id}
    >
      <span>{children}</span>
      {right ? (
        <span className="ml-auto text-[10px] normal-case tracking-[0.06em] text-text-subtle">
          {right}
        </span>
      ) : null}
    </div>
  );
}

/** Status tag (`.tag` + tone). */
export function Tag({
  tone = "neu",
  children,
  className,
}: {
  tone?: "err" | "warn" | "info" | "ok" | "neu" | "vio";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-fit max-w-full items-center gap-1.5 self-start whitespace-nowrap rounded-sm border px-2 font-mono text-[11px] font-medium leading-none",
        tone === "err" && "border-danger/40 text-danger",
        tone === "warn" && "border-warning/40 text-warning",
        tone === "info" && "border-info/40 text-info",
        tone === "ok" && "border-success/40 text-success",
        tone === "neu" && "border-border text-text-muted",
        tone === "vio" && "border-border-strong text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small status chip with a dot (`.chip`). */
export function Chip({
  tone,
  children,
}: {
  tone?: "live" | "stale";
  children: ReactNode;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.08em] text-text-subtle">
      <span
        aria-hidden="true"
        className={cn(
          "h-[5px] w-[5px] rounded-full bg-text-subtle",
          tone === "live" && "bg-success",
          tone === "stale" && "bg-warning",
        )}
      />
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
  size?: "md" | "sm";
};

/** Product button (`.btn`). */
export function Btn({
  variant = "outline",
  size = "sm",
  className,
  type = "button",
  ...rest
}: BtnProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent bg-transparent px-3.5 text-[13px] font-medium tracking-[-0.005em] text-text transition-colors duration-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:transform-none [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:flex-none",
        size === "sm" && "h-[30px] px-3 text-xs",
        variant === "primary" &&
          "border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover active:border-accent-active active:bg-accent-active",
        variant === "ghost" && "text-text-muted hover:bg-surface-hover hover:text-text",
        variant === "outline" &&
          "border-border-strong hover:border-text-subtle hover:bg-surface-hover",
        className,
      )}
      {...rest}
    />
  );
}

/** Kebab overflow button (`.overflow-btn`). */
export function OverflowButton({
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded="false"
      className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-subtle transition-colors duration-100 hover:bg-surface-hover hover:text-text [&_svg]:h-3.5 [&_svg]:w-3.5"
      {...rest}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="3" r="1.3" />
        <circle cx="8" cy="8" r="1.3" />
        <circle cx="8" cy="13" r="1.3" />
      </svg>
    </button>
  );
}

/** Segmented control (`.seg`). */
export function Seg({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center overflow-hidden rounded-sm border border-border"
    >
      {children}
    </div>
  );
}

export function SegTab({
  selected,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-pressed={selected}
      className={cn(
        "h-[30px] border-l border-border px-3 font-mono text-xs font-medium text-text-muted transition-colors duration-100 first:border-l-0 hover:bg-surface-hover hover:text-text",
        selected && "bg-surface-active text-text",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Keyboard hint pill (`.kbd`). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 flex-none items-center gap-[3px] rounded-[3px] border border-border bg-surface-raised px-1.5 font-mono text-[10px] font-medium text-text-subtle">
      {children}
    </span>
  );
}

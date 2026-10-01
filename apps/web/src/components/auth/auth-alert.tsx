import { AlertCircle } from "@/components/ui/hugeicons";

/**
 * Inline auth failure state (design-system.md 15.3): persistent,
 * contextual, never a toast. `role="alert"` for screen readers.
 */
export function AuthAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[12px] border border-danger/40 bg-danger/10 px-3.5 py-3 text-[13px] leading-relaxed text-text"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

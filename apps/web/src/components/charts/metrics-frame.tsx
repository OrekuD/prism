import { Activity, TriangleAlert, Users, Zap } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";
import { Frame } from "@/components/public/frame";

/**
 * Usage metric frame (design-system.md 9.8): 108px cells with a complete
 * 1px border each, registration marks at the corners, mono uppercase
 * labels, large tabular values with muted units. Loading uses metric-
 * shaped skeletons; real zeros render only after a successful response.
 */
export type MetricCell = {
  id: string;
  label: string;
  icon: "visitors" | "sessions" | "events" | "error";
  /**
   * Null renders an explicit unavailable state (em dash), never a
   * synthesized zero. Loading still uses skeletons; real zeros render only
   * after a successful response.
   */
  value: number | null;
  unit?: string;
};

const icons = {
  visitors: Users,
  sessions: Activity,
  events: Zap,
  error: TriangleAlert,
} as const;

const iconTone = {
  visitors: "text-success",
  sessions: "text-accent",
  events: "text-warning",
  error: "text-danger",
} as const;

export function MetricsFrame({
  cells,
  isLoading,
  className,
}: {
  cells: Array<MetricCell>;
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-3",
        className,
      )}
    >
      {cells.map((cell) => {
        const Icon = icons[cell.icon];
        return (
          <Frame key={cell.id} className="h-[108px] px-[22px] pb-[18px] pt-6">
            <div className="flex items-center gap-2.5">
              <Icon
                className={cn("size-3", iconTone[cell.icon])}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="text-[13px] font-medium tracking-normal text-text-subtle">
                {cell.label}
              </span>
            </div>
            {isLoading ? (
              <div className="mt-4 h-8 w-24 animate-pulse rounded-md bg-surface-hover" />
            ) : cell.value === null ? (
              <div className="mt-4 flex items-baseline gap-2">
                <span
                  className="text-[32px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-text-muted"
                  aria-label={`${cell.label} unavailable`}
                >
                  —
                </span>
                {cell.unit ? (
                  <span className="text-[12px] text-text-subtle">
                    {cell.unit}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-[32px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-text">
                  {cell.value.toLocaleString()}
                </span>
                {cell.unit ? (
                  <span className="text-[12px] text-text-subtle">
                    {cell.unit}
                  </span>
                ) : null}
              </div>
            )}
          </Frame>
        );
      })}
    </div>
  );
}

/**
 * Account relationship chart (TanStack Charts).
 *
 * Plots `monthlyRevenue` (x) against `retention` (y) for the given accounts,
 * sizes each point by `seats` through an explicit square-root radius scale
 * (point area ∝ seats, per area-preserving radial encoding), and colors by
 * `segment`. The original Account row flows through the dot mark into the
 * tooltip and the focus/select callbacks — no projection or cast.
 */

import { defineChart, dot } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { scaleSqrt } from "d3-scale";
import { useMemo } from "react";
import { type Account, ACCOUNT_SEGMENTS } from "./account-chart.data";

/** Explicit square-root radius scale: radius ∝ √seats, clamped to 3–22px. */
const seatsRadiusScale = scaleSqrt().range([3, 22]);

/** Segment → semantic chart color (theme-aware via CSS variables). */
const segmentColor = scaleOrdinal<string, string>(ACCOUNT_SEGMENTS, [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
]);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function createAccountsDefinition(accounts: readonly Account[]) {
  return defineChart({
    marks: [
      dot(accounts, {
        x: "monthlyRevenue",
        y: "retention",
        color: "segment",
        r: "seats",
        rScale: seatsRadiusScale,
        fillOpacity: 0.85,
        // Keep identity stable across updates for focus/keyboard/tooltip.
        key: "id",
      }),
    ],
    x: {
      // Compact linear scale: TanStack infers the revenue domain from the
      // mark's x channel — no D3 scale setup needed.
      scale: scaleLinear,
      grid: true,
      axis: {
        label: "Monthly revenue",
        ticks: { format: (value) => usd.format(Number(value)) },
      },
    },
    y: {
      scale: scaleLinear,
      nice: true,
      grid: true,
      axis: {
        label: "Retention (%)",
        ticks: { format: (value) => `${value}%` },
      },
    },
    color: { scale: segmentColor },
    tooltip,
  });
}

export type AccountChartProps = {
  accounts: readonly Account[];
  ariaLabel?: string;
  /** Receives the original Account row (or null) on pointer/keyboard focus. */
  onFocusChange?: (account: Account | null) => void;
  /** Receives the original Account row (or null) on click/Enter. */
  onSelect?: (account: Account | null) => void;
};

export function AccountChart({
  accounts,
  ariaLabel = "Accounts by monthly revenue and retention",
  onFocusChange,
  onSelect,
}: AccountChartProps) {
  // Definition identity is the update boundary; memoize against captured data.
  const definition = useMemo(() => createAccountsDefinition(accounts), [accounts]);

  return (
    <Chart
      definition={definition}
      height={360}
      ariaLabel={ariaLabel}
      onFocusChange={(point) => onFocusChange?.(point?.datum ?? null)}
      onSelect={(point) => onSelect?.(point?.datum ?? null)}
    />
  );
}

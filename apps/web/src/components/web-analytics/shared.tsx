import { cn } from "@/lib/utils";
import type { WebAnalyticsComparisonValue } from "@prism-analytics/types";
import type * as React from "react";

export const numFmt = new Intl.NumberFormat("en-US");

/* -- Segmented control -- */
export function Seg<T extends string>({
	value,
	onChange,
	options,
	label,
	size = "sm",
}: {
	value: T;
	onChange: (next: T) => void;
	options: Array<{ key: T; label: string }>;
	label: string;
	size?: "sm" | "md";
}) {
	return (
		<fieldset className="inline-flex overflow-hidden rounded-[2px] border border-border">
			<legend className="sr-only">{label}</legend>
			{options.map((o, i) => (
				<button
					key={o.key}
					type="button"
					aria-pressed={value === o.key}
					onClick={() => onChange(o.key)}
					className={cn(
						"transition-colors",
						size === "sm"
							? "h-[30px] px-3 font-mono text-xs font-medium"
							: "h-8 px-3.5 text-[13px] font-medium",
						i > 0 && "border-l border-border",
						value === o.key
							? "bg-accent-soft text-text"
							: "text-text-muted hover:bg-surface-hover hover:text-text",
					)}
				>
					{o.label}
				</button>
			))}
		</fieldset>
	);
}

/* -- Delta badge: only visible when compare is on; quiet for no-prior-data -- */
function ArrowUp() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-[11px]"
		>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}
function ArrowDown() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-[11px]"
		>
			<path d="m7 7 10 10" />
			<path d="M17 7v10H7" />
		</svg>
	);
}

export function DeltaBadge({
	value,
	compareOn,
	invert = false,
}: {
	value: WebAnalyticsComparisonValue | null;
	compareOn: boolean;
	invert?: boolean;
}) {
	if (!compareOn || !value) return null;
	if (value.kind === "no-prior-data") {
		return (
			<span
				title="No prior data to compare"
				className="font-mono text-[11px] text-text-subtle"
			>
				—
			</span>
		);
	}
	if (value.kind === "new") {
		return (
			<span className="font-mono text-[11px] font-medium text-success">New</span>
		);
	}
	const up = value.direction === "up";
	const flat = value.direction === "flat";
	const good = flat || (invert ? !up : up);
	if (flat) {
		return (
			<span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted">
				0.0%
			</span>
		);
	}
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-mono text-[11px]",
				good ? "text-success" : "text-danger",
			)}
		>
			{up ? <ArrowUp /> : <ArrowDown />}
			{Math.abs(value.percent).toFixed(1)}%
		</span>
	);
}

/* -- Card helpers -- */
export function PanelHead({
	title,
	children,
	info,
}: {
	title: string;
	children?: React.ReactNode;
	info?: string;
}) {
	return (
		<div className="mb-3.5 flex min-h-8 flex-wrap items-center justify-between gap-3">
			<span className="inline-flex shrink-0 items-center gap-1.5 text-[15px] font-medium tracking-[-0.01em]">
				{title}
				{info ? (
					<span
						title={info}
						aria-label={info}
						className="inline-flex size-4 items-center justify-center rounded-full border border-border text-[10px] text-text-subtle"
					>
						?
					</span>
				) : null}
			</span>
			<div className="flex min-h-8 items-center">
				<div className="min-w-0 max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{children}
				</div>
			</div>
		</div>
	);
}

export function Card({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn("rounded-[2px] border border-border bg-canvas p-5", className)}
		>
			{children}
		</div>
	);
}

export function RankHead({
	name,
	cols,
}: {
	name: string;
	cols: [string, string, string];
}) {
	return (
		<div className="grid grid-cols-[1fr_72px_72px_96px] items-center gap-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-subtle">
			<span className="min-w-0 truncate">{name}</span>
			<span className="text-right">{cols[0]}</span>
			<span className="text-right">{cols[1]}</span>
			<span className="text-right">{cols[2]}</span>
		</div>
	);
}

export function RankRow({
	name,
	chip,
	cols,
	max,
}: {
	name: React.ReactNode;
	chip?: string | null;
	cols: [number, number];
	max: number;
}) {
	return (
		<div className="grid grid-cols-[1fr_72px_72px_96px] items-center gap-3 border-t border-border py-[9px] first:border-t-0">
			<span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
				{chip ? (
					<span className="inline-flex h-[18px] min-w-[26px] flex-none items-center justify-center rounded-[2px] border border-border px-1 font-mono text-[9.5px] font-medium tracking-[0.06em] text-text-muted">
						{chip}
					</span>
				) : null}
				<span className="truncate text-[13px]">{name}</span>
			</span>
			<span className="text-right font-mono text-xs font-medium text-text-muted tabular-nums">
				{numFmt.format(cols[0])}
			</span>
			<span className="text-right font-mono text-xs font-medium text-text-muted tabular-nums">
				{numFmt.format(cols[1])}
			</span>
			<span>
				<span className="block h-1 overflow-hidden rounded-[2px] bg-surface-raised">
					<i
						className="block h-full bg-accent"
						style={{
							width: `${Math.max(3, Math.round((cols[0] / Math.max(1, max)) * 100))}%`,
						}}
					/>
				</span>
			</span>
		</div>
	);
}

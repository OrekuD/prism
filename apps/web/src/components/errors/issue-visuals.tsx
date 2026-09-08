import {
	ERROR_PLATFORM_LABELS,
	LEVEL_LABELS,
	STATUS_LABELS,
} from "@/lib/errorIssues";
import { cn } from "@/lib/utils";
import type {
	ErrorIssueDelta,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueStatus,
} from "@prism-analytics/types";

/**
 * Shared issue visuals for the Errors list and the route-backed detail
 * sheet (task-15 issue detail). One source for the tag recipe + timestamp
 * format so the list and the sheet cannot drift.
 */

export const TAG =
	"inline-flex h-[18px] items-center whitespace-nowrap rounded-full border px-[8px] text-[10px] font-medium tracking-normal";

const DATE_LABEL = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
});

export function dateLabel(value: number) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "–" : DATE_LABEL.format(date);
}

export function LevelTag({ level }: { level: ErrorIssueLevel }) {
	return (
		<span
			className={cn(
				TAG,
				level === "error"
					? "border-danger/40 bg-danger/10 text-danger"
					: "border-warning/40 bg-warning/10 text-warning",
			)}
		>
			{LEVEL_LABELS[level]}
		</span>
	);
}

export function DeltaTag({ delta }: { delta: ErrorIssueDelta }) {
	if (delta === "new")
		return (
			<span className={cn(TAG, "border-accent/40 bg-accent/10 text-accent")}>
				New
			</span>
		);
	if (delta === "regressing")
		return (
			<span className={cn(TAG, "border-danger/40 bg-danger/10 text-danger")}>
				Regressing
			</span>
		);
	if (delta === "declining")
		return (
			<span className={cn(TAG, "border-success/40 bg-success/10 text-success")}>
				Resolving
			</span>
		);
	return <span className="text-[12px] text-text-subtle">–</span>;
}

export function StatusTag({ status }: { status: ErrorIssueStatus }) {
	const tone =
		status === "unresolved"
			? "border-accent/40 bg-accent/10 text-accent"
			: status === "resolved"
				? "border-success/40 bg-success/10 text-success"
				: "border-border bg-surface text-text-muted";
	return <span className={cn(TAG, tone)}>{STATUS_LABELS[status]}</span>;
}

/** The combined "Web · Error" identity used as the list row tag. */
export function PlatformLevelTag({
	platform,
	level,
}: {
	platform: ErrorIssuePlatform;
	level: ErrorIssueLevel;
}) {
	return (
		<span
			className={cn(
				TAG,
				"shrink-0",
				level === "error"
					? "border-danger/40 bg-danger/10 text-danger"
					: "border-warning/40 bg-warning/10 text-warning",
			)}
		>
			{ERROR_PLATFORM_LABELS[platform]} · {LEVEL_LABELS[level]}
		</span>
	);
}

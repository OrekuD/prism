import type React from "react";

/**
 * v2 frame metric card: a bordered frame with a floating mono frame-label,
 * value row and optional caption. Shared by the Sources and Errors pages.
 */
export function MetricCard({
	label,
	children,
	caption,
}: {
	label: string;
	children: React.ReactNode;
	caption?: string;
}) {
	return (
		<div className="relative rounded-[2px] border border-border p-4 pt-5">
			<span className="absolute -top-[7px] left-[14px] bg-canvas px-[5px] font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
				{label}
			</span>
			<div className="flex items-center justify-between gap-2">{children}</div>
			{caption ? (
				<span className="mt-[5px] block text-[10px] text-text-muted">
					{caption}
				</span>
			) : null}
		</div>
	);
}

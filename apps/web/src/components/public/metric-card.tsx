import type React from "react";
import { Frame } from "./frame";

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
		<Frame className="flex h-[88px] flex-col justify-between p-4 pt-5">
			<span className="absolute -top-[7px] left-[14px] bg-canvas px-[6px] text-[13px] font-medium tracking-normal text-text-muted">
				{label}
			</span>
			<div className="flex items-center justify-between gap-2 leading-none">{children}</div>
			{caption ? (
				<span className="block text-[10px] leading-none text-text-muted">{caption}</span>
			) : (
				<span className="block h-[10px]" aria-hidden="true" />
			)}
		</Frame>
	);
}

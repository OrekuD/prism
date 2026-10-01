import React from "react";
import { useBreadcrumbs } from "@/lib/breadcrumbs";
import { cn } from "@/lib/utils";

class BreadcrumbBoundary extends React.Component<
	{ children: React.ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		// Pages rendered without the full provider set (some test harnesses
		// strip the workspace/query modules the trail reads) degrade to no
		// breadcrumb instead of failing the whole page.
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

function PageHeaderBreadcrumbs({
	preTitle,
	title,
}: {
	preTitle?: string;
	title?: string;
}) {
	const trail = useBreadcrumbs();
	const last = trail[trail.length - 1];
	const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;

	const mainTitle = title ?? last?.label ?? "";
	const mainHref = last?.href;
	const pre = preTitle ?? parent?.label;
	const preHref = (preTitle ? undefined : parent?.href) as string | undefined;

	return (
		<nav
			aria-label="Breadcrumb"
			className="flex min-w-0 items-center gap-2 text-[15px]"
		>
			{pre ? (
				preHref ? (
					<a href={preHref} className="truncate text-text-muted transition-colors hover:text-text">
						{pre}
					</a>
				) : (
					<span className="truncate text-text-muted">{pre}</span>
				)
			) : null}
			{pre && mainTitle ? (
				<span aria-hidden="true" className="text-text-subtle">
					/
				</span>
			) : null}
			{mainHref ? (
				<a href={mainHref} aria-current="page" className="truncate font-medium text-text">
					{mainTitle}
				</a>
			) : (
				<span aria-current="page" className="truncate font-medium text-text">
					{mainTitle}
				</span>
			)}
		</nav>
	);
}

/**
 * Page header in the reference style: exactly two breadcrumb slots — a
 * muted pre-title (parent section) and the current page title — with an
 * optional right-aligned action slot. Long trails collapse: the crumb
 * before the last becomes the pre-title. Pages can override either slot
 * with the optional props.
 */
export function PageHeader({
	preTitle,
	title,
	children,
	className,
}: {
	preTitle?: string;
	title?: string;
	children?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex w-full flex-wrap items-center justify-between gap-4",
				className,
			)}
		>
			<BreadcrumbBoundary>
				<PageHeaderBreadcrumbs preTitle={preTitle} title={title} />
			</BreadcrumbBoundary>
			{children ? (
				<div className="flex shrink-0 items-center gap-2">{children}</div>
			) : null}
		</div>
	);
}

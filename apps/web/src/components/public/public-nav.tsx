import { Menu, X } from "@/components/ui/hugeicons";
import React from "react";
import { Link } from "react-router-dom";
import { PrismLogo } from "@/components/brand/prism-logo";
import { authClient } from "@/lib/authClient";
import { useActiveWorkspace } from "@/lib/workspace";
import { TELEMETRY_EVENTS, trackTelemetry } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

import { DOCS_URL } from "@/lib/docs";

const docsHref = `${DOCS_URL}`;

/** Fixed public navigation, with one clear conversion action. */
export function PublicNav() {
	const [open, setOpen] = React.useState(false);
	const { data: sessionData } = authClient.useSession();
	const { data: activeWorkspace } = useActiveWorkspace();
	const isAuthenticated = Boolean(sessionData?.session);
	const homeSlug = (activeWorkspace as { slug?: string } | null)?.slug;
	// The workspace root resolves the last-used project or project directory.
	const dashboardHref = homeSlug ? `/workspace/${homeSlug}` : "/";

	return (
		<header className="fixed inset-x-0 top-0 z-40">
			<nav
				aria-label="Public"
				className="relative border-b border-border bg-canvas/95 backdrop-blur-md"
			>
				<div className="mx-auto flex h-[70px] max-w-[1320px] items-center justify-between px-5 sm:px-8">
					<Link
						to="/"
						aria-label="Prism home"
						className="-m-3 flex items-center p-3"
						onClick={() => setOpen(false)}
					>
						<PrismLogo size={20} />
					</Link>

					<div className="hidden items-center gap-7 md:flex">
						<a href="/#product" className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text">Product</a>
						<a
							href={docsHref}
							target="_blank"
							rel="noreferrer"
							onClick={() =>
								trackTelemetry(TELEMETRY_EVENTS.docsClick, { source: "nav" })
							}
							className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text"
						>
							Docs
						</a>
						<a href="/#self-host" className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text">Self-host</a>
						{isAuthenticated ? null : (
							<Link
								to="/auth/log-in"
								className="text-[13px] font-medium text-text-muted transition-colors duration-150 hover:text-text"
							>
								Sign in
							</Link>
						)}
						<Link
							to={isAuthenticated ? dashboardHref : "/auth/create-account"}
							className="inline-flex h-[36px] items-center whitespace-nowrap rounded-full bg-text px-5 text-[13px] font-semibold text-canvas transition-colors duration-150 hover:bg-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
						>
							{isAuthenticated ? "Dashboard" : "Get started"}
						</Link>
					</div>

					<button
						type="button"
						aria-expanded={open}
						aria-label={open ? "Close menu" : "Open menu"}
						onClick={() => setOpen((value) => !value)}
						className="grid size-10 place-items-center text-text-muted hover:text-text md:hidden"
					>
						{open ? (
							<X className="size-5" aria-hidden="true" />
						) : (
							<Menu className="size-5" aria-hidden="true" />
						)}
					</button>
				</div>

				{open ? (
					<div className="border-t border-border md:hidden">
						<div className="mx-auto max-w-[1320px] px-5 sm:px-8">
							<Link to="/#product" onClick={() => setOpen(false)} className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text">Product</Link>
							<a
								href={docsHref}
								target="_blank"
								rel="noreferrer"
								onClick={() => setOpen(false)}
								className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text"
							>
								Docs
							</a>
							<Link to="/#self-host" onClick={() => setOpen(false)} className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text">Self-host</Link>
							{isAuthenticated ? null : (
								<Link
									to="/auth/log-in"
									onClick={() => setOpen(false)}
									className="flex h-12 items-center border-b border-border text-[14px] text-text-muted hover:text-text"
								>
									Sign in
								</Link>
							)}
							<Link
								to={isAuthenticated ? dashboardHref : "/auth/create-account"}
								onClick={() => setOpen(false)}
								className={cn(
									"my-4 flex h-11 items-center justify-center rounded-full",
									"bg-text text-[14px] font-semibold text-canvas",
								)}
							>
								{isAuthenticated ? "Dashboard" : "Get started"}
							</Link>
						</div>
					</div>
				) : null}
			</nav>
		</header>
	);
}

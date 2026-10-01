import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { EmailVerificationAlert } from "@/components/auth/email-verification-alert";
import { GlobalHeader } from "./global-header";
import { Sidebar } from "./sidebar";

/**
 * v2 dashboard shell: global header on top, 260px sidebar + centered
 * content column below (each page renders its own PageHeader
 * breadcrumbs). Below 1024px the sidebar becomes an off-canvas drawer
 * opened from the global header, with a click-away scrim.
 */
export function DashboardLayout() {
	const [navOpen, setNavOpen] = React.useState(false);
	const { pathname } = useLocation();

	// Close the mobile drawer on navigation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: drawer closes on any route change
	React.useEffect(() => setNavOpen(false), [pathname]);

	const isRealtime = pathname.includes("/realtime");

	return (
		<div className="flex min-h-dvh flex-col">
			<GlobalHeader onMenu={() => setNavOpen(true)} />
			<div className="flex min-h-[calc(100dvh-3.5rem)] flex-1">
				<Sidebar navOpen={navOpen} />
				<button
					type="button"
					aria-label="Close navigation"
					tabIndex={-1}
					onClick={() => setNavOpen(false)}
					className={cn(
						"fixed inset-0 top-14 z-55 bg-black/50 transition-opacity max-[1023px]:block",
						navOpen
							? "pointer-events-auto opacity-100"
							: "pointer-events-none opacity-0",
					)}
				/>
				<div className="flex min-w-0 flex-1 flex-col">
					<div
						className={cn(
							"flex flex-1 flex-col",
							isRealtime
								? "w-full px-7 py-8 max-[1023px]:px-5 max-[1023px]:py-6 max-[767px]:px-4 max-[767px]:py-5"
								: "mx-auto w-full max-w-[1800px] px-7 py-8 max-[1023px]:px-5 max-[1023px]:py-6 max-[767px]:px-4 max-[767px]:py-5",
						)}
					>
						<main className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-150">
							<EmailVerificationAlert />
							<Outlet />
						</main>
					</div>
				</div>
			</div>
		</div>
	);
}

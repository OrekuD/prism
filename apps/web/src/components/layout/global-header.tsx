import { PrismMark } from "@/components/brand/prism-mark";
import { useTheme } from "@/components/theme-provider";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Check,
	FileText,
	Loader2,
	LogOut,
	Moon,
	ShieldCheck,
	Sun,
	Monitor,
	User,
} from "@/components/ui/hugeicons";
import { IconMenu } from "@/components/ui/icons";
import { authClient } from "@/lib/authClient";
import { DOCS_URL } from "@/lib/docs";
import { clearQueryClient, client } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { getInitials } from "@/utils/getInitials";
import React from "react";
import { Link } from "react-router-dom";

/**
 * Global top bar: Prism mark on the left (plus the mobile drawer trigger
 * below 1024px); Docs, the theme picker, and the account menu on the
 * right. Owns the utilities that used to live at the bottom of the
 * sidebar.
 */
export function GlobalHeader({ onMenu }: { onMenu?: () => void }) {
	const { theme, setTheme } = useTheme();
	const { data: session } = authClient.useSession();
	const [signingOut, setSigningOut] = React.useState(false);
	const [userMenuOpen, setUserMenuOpen] = React.useState(false);

	const themeOptions = [
		{ value: "light" as const, label: "Light", Icon: Sun },
		{ value: "dark" as const, label: "Dark", Icon: Moon },
		{ value: "system" as const, label: "System", Icon: Monitor },
	];
	const ThemeIcon =
		theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

	async function onSignOut() {
		if (signingOut) return;
		setSigningOut(true);
		try {
			await authClient.signOut();
			// F7: clear both in-memory and persisted cache before navigating
			// to sign-in.
			clearQueryClient(client);
			window.location.href = "/auth/log-in";
		} catch {
			clearQueryClient(client);
			window.location.href = "/auth/log-in";
		} finally {
			setSigningOut(false);
		}
	}

	return (
		<header className="sticky top-0 z-70 flex h-14 w-full shrink-0 items-center justify-between gap-4 border-b border-border bg-canvas px-3 max-[1023px]:px-4">
			<div className="flex items-center gap-1.5">
				{onMenu ? (
					<button
						type="button"
						aria-label="Open navigation"
						onClick={onMenu}
						className="hidden size-9 place-items-center rounded-[10px] text-[#5D5D5D] transition-colors hover:bg-surface-hover hover:text-text dark:text-text max-[1023px]:grid"
					>
						<IconMenu />
					</button>
				) : null}
				<Link
					to="/overview"
					aria-label="Prism home"
					className="grid size-9 place-items-center rounded-[10px] transition-opacity hover:opacity-90"
				>
					<PrismMark size={22} />
				</Link>
			</div>

			<div className="flex items-center gap-1.5">
				<a
					className={cn(
						"flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-[13px] text-[#5D5D5D] transition-colors hover:bg-surface-hover dark:text-text",
					)}
					href={DOCS_URL}
					target="_blank"
					rel="noreferrer"
				>
					<FileText size={16} />
					<span className="hidden sm:inline">Docs</span>
				</a>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-haspopup="menu"
							aria-label="Theme"
							title={`Theme: ${theme}`}
							className="grid size-9 place-items-center rounded-[10px] text-[#5D5D5D] transition-colors hover:bg-surface-hover hover:text-text dark:text-text"
						>
							<ThemeIcon size={16} />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="bottom" sideOffset={8}>
						<DropdownMenuLabel>Theme</DropdownMenuLabel>
						{themeOptions.map((option) => {
							const Icon = option.Icon;
							return (
								<DropdownMenuItem
									key={option.value}
									onClick={() => setTheme(option.value)}
									className="gap-2"
								>
									<Icon className="size-4" />
									<span className="flex-1">{option.label}</span>
									{theme === option.value ? (
										<Check className="size-3.5 text-accent" />
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>

				<DropdownMenu
					open={userMenuOpen}
					onOpenChange={(open) => {
						// Keep the menu from closing mid sign-out.
						if (!signingOut) setUserMenuOpen(open);
					}}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-haspopup="menu"
							aria-label="Account"
							className="ml-1 grid size-8 shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised text-[11px] font-semibold text-text transition-colors hover:bg-surface-hover"
						>
							{getInitials(session?.user?.name ?? "Prism")}
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						side="bottom"
						sideOffset={8}
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
					>
						<DropdownMenuLabel className="font-normal">
							<span className="block truncate text-[13px] font-medium leading-[1.2]">
								{session?.user?.name ?? "Account"}
							</span>
							<span className="block truncate text-[11px] leading-[1.3] text-text-subtle">
								{session?.user?.email ?? ""}
							</span>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<Link to="/account/general">
							<DropdownMenuItem className="gap-2">
								<User className="size-4" />
								<span className="flex-1">Account</span>
							</DropdownMenuItem>
						</Link>
						<Link to="/account/security">
							<DropdownMenuItem className="gap-2">
								<ShieldCheck className="size-4" />
								<span className="flex-1">Security</span>
							</DropdownMenuItem>
						</Link>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							className="gap-2"
							disabled={signingOut}
							onSelect={(event) => event.preventDefault()}
							onClick={() => void onSignOut()}
						>
							<LogOut className="size-4 text-destructive" />
							<span className="flex-1">Sign out</span>
							{signingOut ? (
								<Loader2
									className="size-4 animate-spin text-destructive"
									aria-hidden="true"
								/>
							) : null}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}

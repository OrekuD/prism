import { PrismLogo } from "@/components/brand/prism-logo";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { useTheme } from "@/components/theme-provider";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as I from "@/components/ui/icons";
import { CreateWorkspaceDialog } from "@/components/workspace/workspace-switcher";
import { authClient } from "@/lib/authClient";
import { clearQueryClient, client } from "@/lib/queryClient";
import {
	getSelectedProjectSlug,
	setSelectedProjectSlug,
	setSelectedWorkspaceSlug,
} from "@/lib/selectedProject";
import { cn } from "@/lib/utils";
import {
	useActiveWorkspace,
	useSelectedWorkspace,
	useWorkspaces,
} from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import { getInitials } from "@/utils/getInitials";
import {
	Check,
	Chart,
	ChevronDown,
	FileText,
	Folder,
	Loader2,
	LogOut,
	Monitor,
	Moon,
	Plus,
	Settings,
	ShieldCheck,
	Smartphone,
	Sun,
	TriangleAlert,
	User,
	Users,
	Globe,
	Zap,
} from "@/components/ui/lucide-icons";
import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

import { DOCS_URL } from "@/lib/docs";

const LINK_BASE =
	"relative flex h-[30px] items-center gap-2.5 rounded-[10px] px-3 text-[13px] text-[#5D5D5D] transition-colors hover:bg-surface-active dark:text-text";
const LINK_ACTIVE = "bg-surface-active text-[#2A2A2A] dark:text-text";

function Active({
	to,
	label,
	icon,
	className,
	end,
	disabled,
}: {
	to: string;
	label: string;
	icon: React.ReactNode;
	className?: string;
	end?: boolean;
	disabled?: boolean;
}) {
	if (disabled) {
		return (
			<span
				role="link"
				aria-disabled="true"
				title="Select a project first"
				className={cn(LINK_BASE, "cursor-default opacity-50", className)}
			>
				{icon}
				{label}
			</span>
		);
	}
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				cn(LINK_BASE, isActive && LINK_ACTIVE, className)
			}
		>
			{icon}
			{label}
		</NavLink>
	);
}

export function Sidebar({ navOpen }: { navOpen?: boolean }) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const { data: session } = authClient.useSession();
	const { data: activeWorkspace } = useActiveWorkspace();
	const {
		data: workspaces,
		isPending: workspacesPending,
		error: workspacesError,
	} = useWorkspaces();
	const { workspace: selectedWorkspace } = useSelectedWorkspace();
	const projectsQuery = useProjectsQuery();

	// F1: trigger + links scope to the URL-selected workspace, not the refetching active org.
	const pathSegments = pathname.split("/");
	const urlWorkspaceSlug =
		pathSegments[1] === "workspace" ? pathSegments[2] : undefined;
	const effectiveWorkspace = urlWorkspaceSlug
		? selectedWorkspace?.slug === urlWorkspaceSlug
			? selectedWorkspace
			: null
		: (selectedWorkspace ?? activeWorkspace);
	const wrkSlug = urlWorkspaceSlug ?? effectiveWorkspace?.slug ?? "";
	// URL shape: /workspace/:wrkSlug/projects/:projectSlug/...
	const urlProjectSlug =
		pathSegments[3] === "projects" ? pathSegments[4] : undefined;
	// Selected project: the URL wins when we're on a project page, otherwise
	// fall back to the per-workspace persisted selection.
	const [persistedSelection, setPersistedSelection] = React.useState<{
		workspace: string;
		slug: string | null;
	} | null>(null);
	const [newProjectOpen, setNewProjectOpen] = React.useState(false);
	React.useEffect(() => {
		setPersistedSelection({
			workspace: wrkSlug,
			slug: wrkSlug ? getSelectedProjectSlug(wrkSlug) : null,
		});
	}, [wrkSlug]);
	React.useEffect(() => {
		if (wrkSlug && urlProjectSlug) {
			setPersistedSelection({ workspace: wrkSlug, slug: urlProjectSlug });
			setSelectedProjectSlug(wrkSlug, urlProjectSlug);
		}
	}, [wrkSlug, urlProjectSlug]);
	const selectedProjectSlug =
		urlProjectSlug ??
		(persistedSelection?.workspace === wrkSlug
			? persistedSelection.slug
			: null);
	const project = projectsQuery.data?.find(
		(entry) => entry.slug === selectedProjectSlug,
	);
	const effectiveSlug =
		urlProjectSlug ??
		project?.slug ??
		(projectsQuery.data === undefined ? selectedProjectSlug : undefined);
	const sourcesQuery = useSourcesQuery(effectiveSlug ?? undefined);
	const workspaceName = effectiveWorkspace?.name ?? urlWorkspaceSlug;
	const allWorkspaces = (workspaces ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
	}>;
	const [newWorkspaceOpen, setNewWorkspaceOpen] = React.useState(false);
	const [signingOut, setSigningOut] = React.useState(false);
	const [userMenuOpen, setUserMenuOpen] = React.useState(false);
	const projects = (projectsQuery.data ?? []) as Array<{
		name: string;
		slug: string;
	}>;
	const hasWebSource =
		sourcesQuery.data === undefined ||
		sourcesQuery.data.some((source) => source.platform === "web");
	const hasMobileSource =
		sourcesQuery.data === undefined ||
		sourcesQuery.data.some((source) =>
			["ios", "android", "react-native"].includes(source.platform),
		);

	const themeOptions = [
		{ value: "light" as const, label: "Light", Icon: Sun },
		{ value: "dark" as const, label: "Dark", Icon: Moon },
		{ value: "system" as const, label: "System", Icon: Monitor },
	];
	const themeLabel =
		theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

	async function onSignOut() {
		if (signingOut) return;
		setSigningOut(true);
		try {
			await authClient.signOut();
			// F7: clear both in-memory and persisted cache before navigating to sign-in.
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
		<aside
			id="sidebar"
			aria-label="Workspace navigation"
			className={cn(
				"sticky top-0 z-60 flex h-dvh w-[260px] shrink-0 flex-col border-r border-border bg-surface",
				"max-[1023px]:fixed max-[1023px]:bottom-0 max-[1023px]:left-0 max-[1023px]:top-0 max-[1023px]:z-60 max-[1023px]:-translate-x-full max-[1023px]:transition-transform max-[1023px]:duration-200 max-[1023px]:ease-out",
				navOpen &&
					"max-[1023px]:translate-x-0 max-[1023px]:shadow-[16px_0_48px_rgb(0_0_0/0.45)]",
			)}
		>
			<div className="flex items-center px-3 pb-2.5 pt-3.5">
				<Link
					to={`/workspace/${wrkSlug}`}
					aria-label="Prism home"
					className="inline-flex items-center gap-2.5 rounded-[10px] transition-opacity hover:opacity-90"
				>
					<PrismLogo size={22} variant="monochrome" className="text-text" />
				</Link>
			</div>

			<nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3 pb-4">
				<div className="flex flex-col gap-1">
					<div className="px-3 pb-1 pt-1 text-[13px] font-medium tracking-normal text-text-subtle">
						Project
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-haspopup="menu"
								title="Switch project"
								className="mb-2 flex h-9 w-full items-center gap-2 rounded-[10px] border border-border bg-surface-raised px-2.5 text-sm font-medium transition-colors hover:bg-surface-hover"
							>
								<Folder size={16} />
								<span className="flex-1 truncate text-left">
									{projectsQuery.isPending
										? (project?.name ??
											selectedProjectSlug ?? (
												<span
													className="inline-block h-[13px] w-20 animate-pulse rounded-md bg-surface-active"
													aria-hidden="true"
												/>
											))
										: (project?.name ?? "Select a project")}
								</span>
								<ChevronDown size={16} />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							side="bottom"
							sideOffset={8}
							className="w-(--radix-dropdown-menu-trigger-width)"
						>
							<DropdownMenuLabel>Projects</DropdownMenuLabel>
							{projects.length === 0 ? (
								<div className="px-2 py-1.5 text-[13px] text-text-subtle">
									{projectsQuery.isError
										? "Couldn't load projects."
										: projectsQuery.isPending
											? "Loading projects…"
											: "No projects yet."}
								</div>
							) : (
								projects.map((entry) => (
									<DropdownMenuItem
										key={entry.slug}
										onClick={() =>
											navigate(`/workspace/${wrkSlug}/projects/${entry.slug}`)
										}
										className="gap-2"
									>
										<Folder size={16} />
										<span className="flex-1 truncate">{entry.name}</span>
										{entry.slug === effectiveSlug ? (
											<Check className="size-3.5 text-accent" />
										) : null}
									</DropdownMenuItem>
								))
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="gap-2"
								onClick={() => setNewProjectOpen(true)}
							>
								<Plus className="size-4" />
								<span className="flex-1">New project</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<CreateProjectDialog
						open={newProjectOpen}
						onOpenChange={setNewProjectOpen}
					/>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}`}
						end
						label="Overview"
						icon={<Chart size={16} />}
					/>
				</div>

				<div className="flex flex-col gap-0.5">
					<div className="px-3 pb-1 pt-1 text-[13px] font-medium tracking-normal text-text-subtle">
						Data
					</div>
					{hasWebSource ? (
						<Active
							disabled={!effectiveSlug}
							to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/web-analytics`}
							label="Web Analytics"
							icon={<Globe className="size-4 shrink-0" />}
						/>
					) : null}
					{hasMobileSource ? (
						<Active
							disabled={!effectiveSlug}
							to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/mobile-analytics`}
							label="Mobile Analytics"
							icon={<Smartphone className="size-4 shrink-0" />}
						/>
					) : null}
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/events`}
						label="Events"
						icon={<Zap size={16} />}
					/>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/people`}
						label="People"
						icon={<User size={16} />}
					/>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/realtime`}
						label="Live"
						icon={<Globe size={16} />}
					/>
				</div>

				<div className="flex flex-col gap-0.5">
					<div className="px-3 pb-1 pt-1 text-[13px] font-medium tracking-normal text-text-subtle">
						Diagnose
					</div>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/errors`}
						label="Errors"
						icon={<TriangleAlert size={16} />}
					/>
				</div>

				<div className="flex flex-col gap-0.5">
					<div className="px-3 pb-1 pt-1 text-[13px] font-medium tracking-normal text-text-subtle">
						Configure
					</div>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/sources`}
						label="Sources"
						icon={<Globe size={16} />}
					/>
					<Active
						disabled={!effectiveSlug}
						to={`/workspace/${wrkSlug}/projects/${effectiveSlug}/settings`}
						label="Project settings"
						icon={<Settings size={16} />}
					/>
				</div>

				<div className="flex flex-col gap-0.5 border-t border-border pt-2.5">
					<div className="px-3 pb-1 pt-1 text-[13px] font-medium tracking-normal text-text-subtle">
						Workspace
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-haspopup="menu"
								title="Switch workspace"
								className="mb-2 flex h-9 w-full items-center gap-2 rounded-[10px] border border-border bg-surface-raised px-2.5 text-sm font-medium transition-colors hover:bg-surface-hover"
							>
								<span className="flex-1 truncate text-left">
									{workspacesPending && !workspaceName ? (
										<span
											className="inline-block h-[13px] w-28 animate-pulse rounded-md bg-surface-raised"
											aria-hidden="true"
										/>
									) : (
										(workspaceName ?? "Select a workspace")
									)}
								</span>
								<ChevronDown size={16} />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							side="bottom"
							sideOffset={8}
							className="w-(--radix-dropdown-menu-trigger-width)"
						>
							<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
							{allWorkspaces.length === 0 ? (
								<div className="px-2 py-1.5 text-[13px] text-text-subtle">
									{workspacesError
										? "Couldn't load workspaces."
										: workspacesPending
											? "Loading workspaces…"
											: "No workspaces yet."}
								</div>
							) : (
								allWorkspaces.map((ws) => (
									<DropdownMenuItem
										key={ws.id}
										className="gap-2"
										onClick={() => {
											if (ws.slug !== wrkSlug) {
												setSelectedWorkspaceSlug(ws.slug);
												navigate(`/workspace/${ws.slug}`);
											}
										}}
									>
										<span className="flex-1 truncate">{ws.name}</span>
										{ws.slug === wrkSlug ? (
											<Check className="size-3.5 text-accent" />
										) : null}
									</DropdownMenuItem>
								))
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="gap-2"
								onClick={() => setNewWorkspaceOpen(true)}
							>
								<Plus className="size-4" />
								<span className="flex-1">New workspace</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<CreateWorkspaceDialog
						open={newWorkspaceOpen}
						onOpenChange={setNewWorkspaceOpen}
					/>
					<Active
						to={`/workspace/${wrkSlug}/projects`}
						end
						label="Projects"
						icon={<Folder size={16} />}
					/>
					<Active
						to={`/workspace/${wrkSlug}/members`}
						label="Members"
						icon={<Users size={16} />}
					/>
					<Active
						to={`/workspace/${wrkSlug}/settings`}
						label="Workspace settings"
						icon={<Settings size={16} />}
					/>
				</div>
			</nav>

			<div className="flex flex-col gap-0.5 border-t border-border px-3 pb-3.5 pt-2.5">
				<a
					className={LINK_BASE}
					href={DOCS_URL}
					target="_blank"
					rel="noreferrer"
				>
					<FileText size={16} />
					Docs
				</a>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-haspopup="menu"
							className={cn(LINK_BASE, "w-full")}
						>
							<Moon size={16} />
							<span className="flex-1 text-left">Theme</span>
							<span className="text-xs text-text-subtle">{themeLabel}</span>
							<ChevronDown size={12} />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						side="bottom"
						sideOffset={8}
						className="w-(--radix-dropdown-menu-trigger-width)"
					>
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
				<div className="mt-2 border-t border-border px-1 pt-2">
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
								className="flex w-full items-center gap-2.5 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-surface-hover"
							>
								<span
									className="grid size-[26px] shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised text-[11px] font-semibold text-text"
									aria-hidden="true"
								>
									{getInitials(session?.user?.name ?? "Prism")}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[13px] font-medium leading-[1.2]">
										{session?.user?.name ?? "Account"}
									</span>
									<span className="block truncate text-[11px] leading-[1.3] text-text-subtle">
										{session?.user?.email ?? ""}
									</span>
								</span>
								<ChevronDown size={14} className="shrink-0 text-text-subtle" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							side="bottom"
							sideOffset={8}
							className="w-(--radix-dropdown-menu-trigger-width)"
						>
							<DropdownMenuLabel className="font-normal">
								Account
							</DropdownMenuLabel>
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
			</div>
		</aside>
	);
}

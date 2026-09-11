import { PrismLogo } from "@/components/brand/prism-logo";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/workspace/workspace-switcher";
import { authClient } from "@/lib/authClient";
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
import {
	Check,
	Chart,
	ChevronDown,
	Folder,
	Plus,
	Settings,
	Smartphone,
	TriangleAlert,
	User,
	Users,
	Globe,
	Zap,
} from "@/components/ui/hugeicons";
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
		// Not a link: with no project selected there is no destination.
		// aria-disabled + tooltip communicate the placeholder state.
		return (
			<span
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


	return (
		<aside
			id="sidebar"
			aria-label="Workspace navigation"
			className={cn(
				"sticky top-14 z-60 flex h-[calc(100dvh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-border bg-surface",
				"max-[1023px]:fixed max-[1023px]:bottom-0 max-[1023px]:left-0 max-[1023px]:top-14 max-[1023px]:z-60 max-[1023px]:h-[calc(100dvh-3.5rem)] max-[1023px]:-translate-x-full max-[1023px]:transition-transform max-[1023px]:duration-200 max-[1023px]:ease-out",
				navOpen &&
					"max-[1023px]:translate-x-0 max-[1023px]:shadow-[16px_0_48px_rgb(0_0_0/0.45)]",
			)}
		>
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

		</aside>
	);
}

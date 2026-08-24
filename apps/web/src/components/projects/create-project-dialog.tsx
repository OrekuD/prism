import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useActiveWorkspace, useWorkspaces } from "@/lib/workspace";
import { useCreateProjectMutation } from "@/network/mutations/useCreateProjectMutation";
import { Loader2 } from "lucide-react";
import React from "react";
import { useNavigate } from "react-router-dom";

const SECTION =
	"font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted";

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Create-project dialog (launched from the sidebar + projects screen).
 * SDK/platform is chosen per source afterwards; the Team dropdown picks
 * which workspace the project is created in. Controlled open state, same
 * pattern as CreateWorkspaceDialog — render it next to the trigger.
 *
 * The form (and its react-query mutation) lives in CreateProjectForm, which
 * only mounts while the dialog is open — a closed dialog on the sidebar
 * needs no QueryClient context.
 */
export function CreateProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[40rem]">
				<DialogHeader>
					<DialogTitle>Create a project</DialogTitle>
					<DialogDescription>
						Name your project and pick the workspace it belongs to. SDK setup
						happens per source afterwards.
					</DialogDescription>
				</DialogHeader>
				<CreateProjectForm onOpenChange={onOpenChange} />
			</DialogContent>
		</Dialog>
	);
}

function CreateProjectForm({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const { data: workspaces } = useWorkspaces();
	const { data: activeWorkspace } = useActiveWorkspace();
	const createProjectMutation = useCreateProjectMutation();

	const [name, setName] = React.useState("");
	const [teamId, setTeamId] = React.useState("");

	const activeId = (activeWorkspace as { id?: string } | null)?.id;
	const list = (workspaces ?? []) as Array<{
		id: string;
		name: string;
		slug: string;
	}>;
	const firstWorkspaceId = list[0]?.id;

	// Pre-select the active workspace once it's known.
	React.useEffect(() => {
		if (!teamId) setTeamId(activeId ?? firstWorkspaceId ?? "");
	}, [teamId, activeId, firstWorkspaceId]);

	const selectedWorkspace =
		list.find((entry) => entry.id === teamId) ??
		(activeWorkspace as { id?: string; slug?: string } | null) ??
		list[0];

	const isPending = createProjectMutation.isPending;
	const slug = slugify(name);
	const canSubmit = Boolean(name.trim()) && !isPending;

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!selectedWorkspace?.id || !name.trim() || isPending) return;
		try {
			await createProjectMutation.mutateAsync({
				organizationId: selectedWorkspace.id,
				name: name.trim(),
			});
			onOpenChange(false);
			navigate(`/workspace/${selectedWorkspace.slug}/projects`);
		} catch {
			// The mutation's onError already surfaced a toast.
		}
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-5">
			<div className="flex w-full gap-6">
				<div className="flex-1 space-y-2.5">
					<div className={SECTION}>Project name</div>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="project-name"
						aria-label="Project name"
						autoFocus
					/>
					<p className="font-mono text-[12px] text-text-subtle">
						{slug || "project-name"} — used in URLs & SDK config.
					</p>
				</div>

				<div className="flex-1 space-y-2.5">
					<div className={SECTION}>Team</div>
					<Select value={teamId} onValueChange={setTeamId}>
						<SelectTrigger aria-label="Team" className="w-full">
							<SelectValue placeholder="Select a team" />
						</SelectTrigger>
						<SelectContent>
							{list.length === 0 ? (
								<p className="px-2 py-1.5 text-[13px] text-text-subtle">
									No workspaces yet.
								</p>
							) : (
								list.map((entry) => (
									<SelectItem key={entry.id} value={entry.id}>
										{entry.name}
									</SelectItem>
								))
							)}
						</SelectContent>
					</Select>
				</div>
			</div>

			<DialogFooter className="sm:justify-between">
				<Button
					type="button"
					variant="outline"
					onClick={() => onOpenChange(false)}
					disabled={isPending}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={!canSubmit}>
					{isPending ? (
						<Loader2 className="size-4 animate-spin" aria-hidden="true" />
					) : null}
					Create project
				</Button>
			</DialogFooter>
		</form>
	);
}

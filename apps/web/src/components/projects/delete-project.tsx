import { Loader2 } from "lucide-react";
import React from "react";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";

import { useDeleteProjectMutation } from "@/network/mutations/useDeleteProjectMutation";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism/types";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

export function DeleteProject(props: React.PropsWithChildren) {
	const navigate = useNavigate();
	const [open, setOpen] = React.useState(false);
	const { slug } = useParams<{ slug: string }>();
	const [searchParams, setSearchParams] = useSearchParams();

	const duration = searchParams.get(
		"duration",
	) as ProjectDetailedRequest["duration"];
	const projectQuery = useProjectQuery({ slug, duration });
	const deleteProjectMutation = useDeleteProjectMutation();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent className="w-[90vw] md:w-full rounded-lg">
				<DialogHeader>
					<DialogTitle>Delete Project</DialogTitle>
					<DialogDescription>
						All data associated with this project will be deleted. This action
						is irreversible.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						variant="outline"
						disabled={deleteProjectMutation.isPending}
						onClick={() => {
							setOpen(false);
						}}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={
							deleteProjectMutation.isPending ||
							projectQuery.isLoading ||
							!projectQuery.data
						}
						onClick={async () => {
							if (!projectQuery.data) return;
							const response = await deleteProjectMutation.mutateAsync(
								projectQuery.data.id,
							);
							if (response?.message) {
								setOpen(false);
								navigate("/projects");
							}
						}}
					>
						{deleteProjectMutation.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							"Delete Project"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

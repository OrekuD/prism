import React from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";
import { Plus, CircleX, Link , Loader2 } from "lucide-react";
import { FormField, FormItem, FormControl, FormMessage, Form } from "../ui/form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useInviteTeamMembersMutation } from "@/network/mutations/useInviteTeamMembersMutation";

import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { useUserStore } from "@/store/userStore";
import { useTeamInviteLinkQuery } from "@/network/queries/useTeamInviteLinkQuery";
import { toast } from "sonner";
import { useCreateProjectMutation } from "@/network/mutations/useCreateProjectMutation";
import { Label } from "../ui/label";
import { useActiveTeamStore } from "@/store/activeTeamStore";

const createProjectFormSchema = z.object({
	name: z.string(),
});

export function CreateNewProject(props: React.PropsWithChildren) {
	const [open, setOpen] = React.useState(false);
	const createProjectMutation = useCreateProjectMutation();
	const { teamId } = useActiveTeamStore();

	const createNewProjectForm = useForm({
		resolver: zodResolver(createProjectFormSchema),
		defaultValues: {
			name: "",
		},
	});

	async function onSubmit(values: z.infer<typeof createProjectFormSchema>) {
		if (!teamId) return;
		const { message } = await createProjectMutation.mutateAsync({
			teamId,
			name: values.name,
		});

		if (message) {
			setOpen(false);
			createNewProjectForm.reset();
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent className="w-[90vw] md:w-full rounded-lg">
				<DialogHeader>
					<DialogTitle>Create Project</DialogTitle>
					<DialogDescription />
				</DialogHeader>
				<div>
					<div className="w-full space-y-4">
						<Form {...createNewProjectForm}>
							<form
								className=""
								onSubmit={createNewProjectForm.handleSubmit(onSubmit)}
							>
								<FormField
									control={createNewProjectForm.control}
									name="name"
									render={({ field }) => (
										<FormItem className="w-full">
											<FormControl>
												<div className="space-y-2">
													<Label>Name</Label>
													<Input
														placeholder=""
														className="flex-1 h-9"
														{...field}
													/>
													<FormMessage className="text-xs font-normal ml-3 mt-2" />
												</div>
											</FormControl>
										</FormItem>
									)}
								/>
								<div className="flex items-center justify-end mt-5 gap-3">
									<DialogClose asChild>
										<Button
											variant="outline"
											disabled={createProjectMutation.isPending}
											onClick={() => {
												createNewProjectForm.reset();
											}}
										>
											Cancel
										</Button>
									</DialogClose>
									<Button
										disabled={createProjectMutation.isPending}
										type="submit"
									>
										{createProjectMutation.isPending ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											"Create"
										)}
									</Button>
								</div>
							</form>
						</Form>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

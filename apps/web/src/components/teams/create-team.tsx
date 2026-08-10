import { Loader2 } from "lucide-react";
import type React from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useForm } from "react-hook-form";
import { CreateTeamRequestSchema } from "@prism/types";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../ui/form";
import type { z } from "zod";
import { useCreateTeamMutation } from "@/network/mutations/useCreateTeamMutation";


type CreateTeamProps = {
	open: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export function CreateTeam(props: React.PropsWithChildren<CreateTeamProps>) {
	const createTeamMutation = useCreateTeamMutation();
	const form = useForm({
		resolver: zodResolver(CreateTeamRequestSchema),
		defaultValues: {
			name: "",
		},
	});

	async function onSubmit(values: z.infer<typeof CreateTeamRequestSchema>) {
		const { id } = await createTeamMutation.mutateAsync(values);

		if (id) {
			form.reset();
			props.setOpen(false);
		}
	}

	return (
		<Dialog open={props.open} onOpenChange={props.setOpen}>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent className="w-[90vw] md:w-full rounded-lg">
				<DialogHeader>
					<DialogTitle>Create team</DialogTitle>
					<DialogDescription>Add a new team</DialogDescription>
				</DialogHeader>
				<Form {...form}>
					<form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Team Name</FormLabel>
									<FormControl>
										<Input placeholder="Team Inc." {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									form.reset();
									props.setOpen(false);
								}}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={createTeamMutation.isPending}>
								{createTeamMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

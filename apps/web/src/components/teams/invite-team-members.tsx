import React from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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

type Props = {
	teamId: string;
	setTeamId: React.Dispatch<React.SetStateAction<string>>;
};

const inviteUserFormSchema = z.object({
	email: z.string().email(),
});

export function InviteTeamMembers(props: Props) {
	const inviteTeamMembersMutation = useInviteTeamMembersMutation();
	const [emails, setEmails] = React.useState<Array<string>>([]);
	const { user } = useUserStore();
	const teamInviteLinkQuery = useTeamInviteLinkQuery(props.teamId);

	const inviteUserForm = useForm({
		resolver: zodResolver(inviteUserFormSchema),
		defaultValues: {
			email: "",
		},
	});

	function onSubmitInviteUsersForm(
		values: z.infer<typeof inviteUserFormSchema>,
	) {
		if (user?.email.toLowerCase() === values.email) {
			inviteUserForm.setError("email", {
				message: "You are already a member.",
			});
			return;
		}

		const index = emails.findIndex((email) => values.email === email);

		if (index < 0) {
			setEmails((prevValues) => [
				...prevValues,
				values.email.trim().toLowerCase(),
			]);
			inviteUserForm.reset();
		} else {
			inviteUserForm.setError("email", {
				message: "Email already added",
			});
		}
	}

	return (
		<Dialog
			open={Boolean(props.teamId)}
			onOpenChange={() => props.setTeamId("")}
		>
			<DialogContent className="w-[90vw] md:w-full rounded-lg">
				<DialogHeader>
					<DialogTitle>Invite Users</DialogTitle>
					<DialogDescription>Send invites to join your team.</DialogDescription>
				</DialogHeader>
				<div>
					<div className="w-full space-y-4 py-2">
						<Form {...inviteUserForm}>
							<form
								className="w-full flex items-center gap-2"
								onSubmit={inviteUserForm.handleSubmit(onSubmitInviteUsersForm)}
							>
								<FormField
									control={inviteUserForm.control}
									name="email"
									render={({ field }) => (
										<FormItem className="w-full">
											<FormControl>
												<div>
													<Input
														type="email"
														placeholder="user@email.com"
														className="flex-1 h-9"
														{...field}
													/>
													<FormMessage className="text-xs font-normal ml-3 mt-2" />
												</div>
											</FormControl>
										</FormItem>
									)}
								/>
								<button
									className="size-8 rounded-full border-2 border-primary grid place-items-center"
									type="submit"
								>
									<Plus className="size-4" />
								</button>
							</form>
						</Form>
						<div className="flex items-center gap-2 flex-wrap">
							{emails.map((email) => (
								<div
									key={email}
									className="flex items-center pl-2 pr-1 gap-2 h-6 text-xs border rounded-full"
								>
									{email}
									<button
										type="button"
										onClick={() =>
											setEmails((emails) =>
												emails.filter((_email) => email !== _email),
											)
										}
									>
										<CircleX className="size-4" />
									</button>
								</div>
							))}
						</div>
					</div>
				</div>
				<DialogFooter className="items-center">
					<button
						type="button"
						className="text-xs font-medium border h-7 rounded-full flex items-center px-4 mr-auto gap-2 transition-opacity disabled:opacity-50"
						disabled={teamInviteLinkQuery.isLoading}
						onClick={async () => {
							if (!teamInviteLinkQuery.data) return;

							await navigator.clipboard.writeText(
								teamInviteLinkQuery.data.teamInviteUrl,
							);

							toast("Invite link copied to clipboard");
						}}
					>
						<Link className="size-3" />
						Copy Invite Link
					</button>
					<Button
						variant="outline"
						disabled={inviteTeamMembersMutation.isPending}
						onClick={() => {
							setEmails([]);
							inviteUserForm.reset();
							props.setTeamId("");
						}}
					>
						Cancel
					</Button>
					<Button
						disabled={
							inviteTeamMembersMutation.isPending || emails.length === 0
						}
						onClick={async () => {
							const { message } = await inviteTeamMembersMutation.mutateAsync({
								emails,
								teamId: props.teamId,
							});

							if (message) {
								setEmails([]);
								inviteUserForm.reset();
								props.setTeamId("");
							}
						}}
					>
						{inviteTeamMembersMutation.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							"Send Invites"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

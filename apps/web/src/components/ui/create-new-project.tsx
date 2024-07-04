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
} from "./dialog";
import { Plus, CircleX, Link } from "lucide-react";
import { FormField, FormItem, FormControl, FormMessage, Form } from "./form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "./input";
import { Button } from "./button";
import { useInviteTeamMembersMutation } from "@/network/mutations/useInviteTeamMembersMutation";
import { LoadingSpinner } from "./loading-spinner";
import { useTeamsQuery } from "@/network/queries/useTeamsQuery";
import { useUserStore } from "@/store/userStore";
import { useTeamInviteLinkQuery } from "@/network/queries/useTeamInviteLinkQuery";
import { toast } from "sonner";
import { useCreateProjectMutation } from "@/network/mutations/useCreateProjectMutation";
import { Label } from "./label";

const createProjectFormSchema = z.object({
  name: z.string(),
});

export function CreateNewProject(props: React.PropsWithChildren) {
  const createProjectMutation = useCreateProjectMutation();

  const createNewProjectForm = useForm({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: "",
    },
  });

  function onSubmit(values: z.infer<typeof createProjectFormSchema>) {}

  return (
    <Dialog>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <div>
          <div className="w-full space-y-4">
            <Form {...createNewProjectForm}>
              <form
                className="w-full flex items-center gap-2"
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
              </form>
            </Form>
          </div>
        </div>
        <DialogFooter className="items-center">
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
            onClick={async () => {
              // const { message } = await inviteTeamMembersMutation.mutateAsync({
              //   emails,
              //   teamId: props.teamId,
              // });
              // if (message) {
              //   setEmails([]);
              //   inviteUserForm.reset();
              //   props.setTeamId("");
              // }
            }}
          >
            {createProjectMutation.isPending ? <LoadingSpinner /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

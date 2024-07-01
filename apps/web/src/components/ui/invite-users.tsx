import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Plus, CircleX } from "lucide-react";
import { FormField, FormItem, FormControl, FormMessage, Form } from "./form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "./input";
import { Button } from "./button";

type Props = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const inviteUserFormSchema = z.object({
  email: z.string().email(),
});

export function InviteUsers(props: Props) {
  const [emails, setEmails] = React.useState<Array<string>>([]);

  const inviteUserForm = useForm({
    resolver: zodResolver(inviteUserFormSchema),
    defaultValues: {
      email: "",
    },
  });

  function onSubmitInviteUsersForm(
    values: z.infer<typeof inviteUserFormSchema>,
  ) {
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
    <Dialog open={props.open} onOpenChange={props.setOpen}>
      <DialogContent>
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
              {emails.map((email, index) => (
                <div
                  key={index}
                  className="flex items-center pl-2 pr-1 gap-2 h-6 text-xs border rounded-full"
                >
                  {email}
                  <button
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
        <DialogFooter>
          <Button variant="outline" onClick={() => {}}>
            Cancel
          </Button>
          <Button>Send Invites</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

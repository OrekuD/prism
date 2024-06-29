import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/store/userStore";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useUpdateUserInformationMutation } from "@/network/mutations/useUpdateUserInformationMutation";
import {
  UpdateUserInformationRequestSchema,
  UpdateUsernameRequestSchema,
} from "@prism/types";
import { useUpdateUsernameMutation } from "@/network/mutations/useUpdateUsernameMutation";

export function AccountGeneral() {
  const { user } = useUserStore();
  const updateUserInformationMutation = useUpdateUserInformationMutation();
  const updateUsernameMutation = useUpdateUsernameMutation();

  const profileForm = useForm({
    resolver: zodResolver(UpdateUserInformationRequestSchema),
    defaultValues: {
      firstName: user?.profile?.firstName || "",
      lastName: user?.profile?.lastName || "",
    },
  });

  const usernameForm = useForm({
    resolver: zodResolver(UpdateUsernameRequestSchema),
    defaultValues: {
      userName: user?.userName || "",
    },
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Form {...profileForm}>
            <form
              onSubmit={profileForm.handleSubmit((values) =>
                updateUserInformationMutation.mutate(values),
              )}
              className="space-y-6"
            >
              <div className="grid grid-cols-2 gap-4 px-6">
                <FormField
                  control={profileForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane" required {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={profileForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" required {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <CardFooter className="border-t px-6 py-4">
                <Button type="submit">
                  {updateUserInformationMutation.isPending ? (
                    <LoadingSpinner />
                  ) : (
                    "Update"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Username</CardTitle>
          <CardDescription>Your Prism username</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Form {...usernameForm}>
            <form
              onSubmit={usernameForm.handleSubmit((values) =>
                updateUsernameMutation.mutate(values),
              )}
              className="space-y-6"
            >
              <FormField
                control={usernameForm.control}
                name="userName"
                render={({ field }) => (
                  <FormItem className="px-6">
                    <FormControl>
                      <Input placeholder="" required {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <CardFooter className="border-t px-6 py-4">
                <Button type="submit">
                  {updateUsernameMutation.isPending ? (
                    <LoadingSpinner />
                  ) : (
                    "Update"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Email</CardTitle>
          <CardDescription>Your Prism email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Email" defaultValue={user?.email} />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Select an avatar</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Display Name" />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card className="border-destructive">
        <CardHeader className="gap-1">
          <CardTitle className="text-destructive">Delete Account</CardTitle>
          <CardDescription>Warning: Permanent Account Deletion</CardDescription>
          <CardDescription>
            This will irreversibly remove your Personal Account and all
            associated content from Prism.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t px-6 py-4">
          <Button variant="destructive">Delete my account</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

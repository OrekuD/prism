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
  ChangeEmailRequestSchema,
  UpdateUserInformationRequestSchema,
  UpdateUsernameRequestSchema,
} from "@prism/types";
import { useUpdateUsernameMutation } from "@/network/mutations/useUpdateUsernameMutation";
import { useChangeEmailMutation } from "@/network/mutations/useChangeEmailMutation";
import { useSignOutFromAllSessionsMutation } from "@/network/mutations/useSignOutFromAllSessionsMutation";
import { Pencil } from "lucide-react";
import defaultAvatar from "@/assets/images/default_profile.png";
import { useUpdateProfilePictureMutation } from "@/network/mutations/useUpdateProfilePictureMutation";

export function AccountGeneral() {
  const { user } = useUserStore();
  const [uploadedProfileImage, setUploadedProfileImage] =
    React.useState<File | null>(null);
  const updateUserInformationMutation = useUpdateUserInformationMutation();
  const updateUsernameMutation = useUpdateUsernameMutation();
  const changeEmailMutation = useChangeEmailMutation();
  const signOutFromAllSessionsMutation = useSignOutFromAllSessionsMutation();
  const updateProfilePictureMutation = useUpdateProfilePictureMutation();

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

  const emailForm = useForm({
    resolver: zodResolver(ChangeEmailRequestSchema),
    defaultValues: {
      email: user?.email || "",
    },
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Profile Information</CardTitle>
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
                <Button
                  type="submit"
                  disabled={updateUserInformationMutation.isPending}
                >
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
                <Button
                  type="submit"
                  disabled={updateUsernameMutation.isPending}
                >
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
        <CardContent className="px-0 pb-0">
          <Form {...emailForm}>
            <form
              onSubmit={emailForm.handleSubmit((values) =>
                changeEmailMutation.mutate(values),
              )}
              className="space-y-6"
            >
              <FormField
                control={emailForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="px-6">
                    <FormControl>
                      <Input placeholder="" type="email" required {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <CardFooter className="border-t px-6 py-4">
                <Button type="submit" disabled={changeEmailMutation.isPending}>
                  {changeEmailMutation.isPending ? (
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
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Select an avatar</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="w-fit">
            <label htmlFor="profile-picture-input">
              <div
                className={`size-20 rounded-full border-2 border-primary relative bg-border ${updateProfilePictureMutation.isPending ? "opacity-60" : ""}`}
              >
                <img
                  src={
                    uploadedProfileImage
                      ? URL.createObjectURL(uploadedProfileImage)
                      : user?.profile?.profilePictureUrl
                        ? user.profile.profilePictureUrl
                        : defaultAvatar
                  }
                  className="w-full h-full object-cover rounded-full selection:bg-transparent"
                />
                <div className="absolute bottom-0 right-0 size-6 bg-white rounded-full grid place-items-center">
                  <Pencil className="size-3 text-background" />
                </div>
              </div>
            </label>
            <Input
              placeholder="Display Name"
              type="file"
              id="profile-picture-input"
              accept="image/*"
              className="hidden"
              disabled={updateProfilePictureMutation.isPending}
              onChange={(e) => {
                if (e.target.files) {
                  const files = Array.from(e.target.files);
                  setUploadedProfileImage(files[0]);
                }
              }}
            />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4 gap-4">
          <Button
            disabled={
              updateProfilePictureMutation.isPending || !uploadedProfileImage
            }
            onClick={async () => {
              const { profilePictureUrl } =
                await updateProfilePictureMutation.mutateAsync({
                  file: uploadedProfileImage!,
                });

              if (profilePictureUrl) {
                setUploadedProfileImage(null);
              }
            }}
          >
            {updateProfilePictureMutation.isPending ? (
              <LoadingSpinner />
            ) : (
              "Update"
            )}
          </Button>
          {uploadedProfileImage ? (
            <Button
              variant="outline"
              className="border-destructive/75"
              onClick={() => setUploadedProfileImage(null)}
              disabled={updateProfilePictureMutation.isPending}
            >
              Reset
            </Button>
          ) : null}
        </CardFooter>
      </Card>
      <Card className="border-destructive">
        <CardHeader className="gap-1">
          <CardTitle className="text-destructive">
            Sign Out From All Sessions
          </CardTitle>
          <CardDescription>
            This will sign you out of all other active sessions.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t px-6 py-4">
          <Button
            variant="destructive"
            disabled={signOutFromAllSessionsMutation.isPending}
            onClick={() => signOutFromAllSessionsMutation.mutate()}
          >
            {signOutFromAllSessionsMutation.isPending ? (
              <LoadingSpinner />
            ) : (
              "Sign out"
            )}
          </Button>
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
          <Button variant="destructive" disabled>
            Delete my account
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

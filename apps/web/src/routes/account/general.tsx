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
import { UpdateUserInformationRequestSchema } from "@prism-analytics/types";
import { Pencil , Loader2 } from "@/components/ui/hugeicons";
import defaultAvatar from "@/assets/images/default_profile.png";
import { useUpdateProfilePictureMutation } from "@/network/mutations/useUpdateProfilePictureMutation";

export function AccountGeneral() {
  const { user } = useUserStore();
  const [uploadedProfileImage, setUploadedProfileImage] =
    React.useState<File | null>(null);
  const updateUserInformationMutation = useUpdateUserInformationMutation();
  const updateProfilePictureMutation = useUpdateProfilePictureMutation();

  const profileForm = useForm({
    resolver: zodResolver(UpdateUserInformationRequestSchema),
    defaultValues: {
      firstName: user?.profile?.firstName || "",
      lastName: user?.profile?.lastName || "",
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
                updateUserInformationMutation.mutate(values)
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
                    <Loader2 className="size-4 animate-spin" />
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
                  alt=""
                  className="w-full h-full object-cover rounded-full selection:bg-transparent"
                />
                <div className="absolute bottom-0 right-0 size-6 bg-background rounded-full grid place-items-center shadow-xl">
                  <Pencil className="size-3 text-primary" />
                </div>
              </div>
            </label>
            <Input
              id="profile-picture-input"
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setUploadedProfileImage(file);
                }
              }}
            />
            <Button
              type="button"
              className="mt-4"
              disabled={
                updateProfilePictureMutation.isPending || !uploadedProfileImage
              }
              onClick={async () => {
                if (!uploadedProfileImage) return;
                const { profilePictureUrl } =
                  await updateProfilePictureMutation.mutateAsync({
                    file: uploadedProfileImage,
                  });

                if (profilePictureUrl) {
                  setUploadedProfileImage(null);
                }
              }}
            >
              {updateProfilePictureMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Upload avatar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

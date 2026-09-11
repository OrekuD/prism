import React from "react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Pencil, Loader2 } from "@/components/ui/hugeicons";
import { Input } from "@/components/ui/input";
import { Frame, SectionLabel } from "@/components/public/frame";
import { useUpdateProfilePictureMutation } from "@/network/mutations/useUpdateProfilePictureMutation";
import { useUpdateUserInformationMutation } from "@/network/mutations/useUpdateUserInformationMutation";
import { useUserStore } from "@/store/userStore";
import { UpdateUserInformationRequestSchema } from "@prism-analytics/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import defaultAvatar from "@/assets/images/default_profile.png";

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
      <Frame className="p-6">
        <SectionLabel>Profile</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Your name as it appears across the workspace.
        </p>
        <Form {...profileForm}>
          <form
            onSubmit={profileForm.handleSubmit((values) =>
              updateUserInformationMutation.mutate(values),
            )}
            className="mt-4 grid gap-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="flex justify-end border-t border-border pt-4">
              <Button
                type="submit"
                className="rounded-full"
                disabled={updateUserInformationMutation.isPending}
              >
                {updateUserInformationMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Update"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </Frame>

      <Frame className="p-6">
        <SectionLabel>Avatar</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Select an avatar for your account.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <label htmlFor="profile-picture-input" className="cursor-pointer">
            <div
              className={`relative size-20 rounded-full border border-border bg-surface-raised ${
                updateProfilePictureMutation.isPending ? "opacity-60" : ""
              }`}
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
                className="h-full w-full rounded-full object-cover selection:bg-transparent"
              />
              <div className="absolute bottom-0 right-0 grid size-6 place-items-center rounded-full border border-border bg-canvas">
                <Pencil className="size-3 text-text-muted" />
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
            className="rounded-full"
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
        </div>
      </Frame>
    </div>
  );
}

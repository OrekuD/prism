import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import type {
  ErrorResource,
  ProfilePictureResource,
  UpdateProfilePictureRequest,
} from "@prism-analytics/types";
import type { AxiosError } from "axios";

async function updateProfile(payload: UpdateProfilePictureRequest) {
  const url = "/user/update-profile-picture";

  const formData = new FormData();
  formData.append("file", payload.file);

  const response = await axiosInstance.put(url, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  if (response.status === 200) {
    return response.data;
  }
}

export function useUpdateProfilePictureMutation() {
  const userStore = useUserStore();

  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (data: ProfilePictureResource) => {
      userStore.updateProfilePicture(data);
    },
    onError: (error: AxiosError<ErrorResource>) => {
      toast("There was a problem uploading your profile picture");
    },
  });
}

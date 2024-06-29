import { useMutation } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";
import type {
  ChangeEmailRequest,
  ChangeEmailResource,
  ErrorResource,
} from "@prism/types";
import { AxiosError } from "axios";
import { useSendVerifyEmailMutation } from "./useSendVerifyEmailMutation";

async function changeEmail(payload: ChangeEmailRequest) {
  const url = "/user/change-email";

  const response = await axiosInstance.put(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useChangeEmailMutation() {
  const userStore = useUserStore();
  const sendVerifyEmailMutation = useSendVerifyEmailMutation();

  return useMutation({
    mutationFn: changeEmail,
    onSuccess: (data: ChangeEmailResource) => {
      userStore.changeEmail(data);
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "email_taken":
            toast("Email is taken");
            break;
          case "email_not_verified":
            toast("Email not verified", {
              description:
                "You need to verify your current email to change it.",
              action: {
                label: "Send verification email",
                onClick: () => sendVerifyEmailMutation.mutate(),
              },
            });
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}

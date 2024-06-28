import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { axiosInstance } from "@/utils/axiosInstance";
import { UserResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function getCurrentUser() {
  const response = await axiosInstance.get("/user");

  console.log({ data: response.data });

  if (response.status === 200) {
    return response.data;
  }

  // const error = response.data?.errors?.[0] || "Something went wrong.";

  //   if (error === "invalid_token") {
  //     localStorage.removeItem(LocalStorageKeys.AUTHENTICATION);
  //   }

  localStorage.removeItem(LocalStorageKeys.AUTHENTICATION);

  return Promise.reject(response.data);
}
export function useCurrentUser() {
  return useQuery<UserResource>({
    queryKey: ["current-user"],
    queryFn: getCurrentUser,
  });
}

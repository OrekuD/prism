import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { axiosInstance } from "@/utils/axiosInstance";
import type { UserResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function currentUser() {
  const accessToken = localStorage.getItem(LocalStorageKeys.TOKEN);

  const response = await axiosInstance.get("/user", {
    headers: {
      Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
    },
  });

  if (response.status === 200) {
    console.log({ __data: response.data });
    return response.data;
  }
}
export function useCurrentUserQuery() {
  return useQuery<UserResource>({
    queryKey: ["current-user"],
    queryFn: currentUser,
    meta: {
      logOut: true,
    },
    enabled: Boolean(localStorage.getItem(LocalStorageKeys.TOKEN) || ""),
    retry: 20,
  });
}

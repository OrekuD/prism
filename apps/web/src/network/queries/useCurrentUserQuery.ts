import { axiosInstance } from "@/utils/axiosInstance";
import type { UserResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

async function currentUser() {
  const response = await axiosInstance.get<UserResource>("/user");

  if (response.status === 200) {
    return response.data;
  }
  throw new Error("current_user_failed");
}

export function useCurrentUserQuery(enabled: boolean) {
  return useQuery<UserResource>({
    queryKey: ["current-user"],
    queryFn: currentUser,
    enabled,
    refetchOnWindowFocus: false,
  });
}

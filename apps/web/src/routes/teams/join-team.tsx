import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useJoinTeamMutation } from "@/network/mutations/useJoinTeamMutation";
import { useTeamInviteQuery } from "@/network/queries/useTeamInviteQuery";
import { useUserStore } from "@/store/userStore";
import React from "react";
import { authClient } from "@/lib/authClient";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export function JoinTeam() {
  const joinTeamMutation = useJoinTeamMutation();
  const { isLoading, data } = useTeamInviteQuery();
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const { user } = useUserStore();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] w-full grid place-content-center px-4 text-center">
      <Card className="mx-auto w-full md:w-96">
        {!isLoading && !data ? (
          <CardContent className="space-y-4 py-4">
            <CardTitle className="text-xl">Link has expired</CardTitle>
          </CardContent>
        ) : (
          <CardContent className="space-y-4 py-4">
            <CardTitle className="text-xl">
              You've been invited to join
            </CardTitle>
            {isLoading ? (
              <Skeleton className="w-32 h-9 mx-auto" />
            ) : (
              <CardTitle className="text-3xl">{data?.name}</CardTitle>
            )}
            <div className="grid place-items-center">
              <Button
                disabled={
                  isLoading || !isAuthenticated || joinTeamMutation.isPending
                }
                onClick={async () => {
                  if (!data) return;
                  const response = await joinTeamMutation.mutateAsync({
                    teamId: data.id,
                  });

                  if (response?.message) {
                    navigate("/projects");
                  }
                }}
              >
                {joinTeamMutation.isPending ? <LoadingSpinner /> : "Join"}
              </Button>
            </div>
            {isAuthenticated ? (
              <div className="mt-4 text-sm">
                You are signed in as{" "}
                <span className="font-semibold">{user?.email}</span>
              </div>
            ) : (
              <div className="mt-4 text-sm">
                You need to{" "}
                <Link
                  to={`/auth/log-in?redirect=/join?token=${token}`}
                  className="font-semibold underline"
                >
                  sign in
                </Link>{" "}
                to continue
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamInviteQuery } from "@/network/queries/useTeamInviteQuery";
import { useAuthenticationStore } from "@/store/authenticationStore";
import { useUserStore } from "@/store/userStore";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";

export function JoinTeam() {
  const { isLoading, data } = useTeamInviteQuery();
  const { isAuthenticated } = useAuthenticationStore();
  const { user } = useUserStore();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  return (
    <div className="h-[100dvh] w-full grid place-content-center px-4 text-center">
      <Card className="mx-auto w-full md:w-96">
        <CardContent className="space-y-4 py-4">
          <CardTitle className="text-xl">You've been invited to join</CardTitle>
          {isLoading ? (
            <Skeleton className="w-32 h-9 mx-auto" />
          ) : (
            <CardTitle className="text-3xl">{data?.name}</CardTitle>
          )}
          <div className="grid place-items-center">
            <Button disabled={isLoading || !isAuthenticated}>Join</Button>
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
      </Card>
    </div>
  );
}

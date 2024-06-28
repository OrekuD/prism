import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/network/queries/useCurrentUser";
import React from "react";
import { Link } from "react-router-dom";

export function Index() {
  const { isSuccess } = useCurrentUser();
  return (
    <div className="flex flex-col items-center gap-2">
      {isSuccess ? (
        <Button asChild>
          <Link to="/projects">Projects</Link>
        </Button>
      ) : (
        <>
          <Button asChild>
            <Link to="/auth/log-in">Sign In</Link>
          </Button>
          <Button asChild>
            <Link to="/auth/create-account">Create Account</Link>
          </Button>
        </>
      )}
    </div>
  );
}

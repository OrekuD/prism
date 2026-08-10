import { Button } from "@/components/ui/button";
import React from "react";
import { authClient } from "@/lib/authClient";
import { Link } from "react-router-dom";

export function Index() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  return (
    <div className="flex flex-col items-center gap-2">
      {isAuthenticated ? (
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

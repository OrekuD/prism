import React from "react";
import TeamSwitcher from "./team-switcher";
import { UserNav } from "./user-nav";
import { Link } from "react-router-dom";

export function Nav() {
  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-8 gap-6">
        <TeamSwitcher />
        <nav className={"flex items-center space-x-4 lg:space-x-6 ml-auto"}>
          <Link
            to="#"
            className="text-sm font-medium px-3 py-2 border rounded-sm"
          >
            Feedback
          </Link>
          <Link to="#" className="text-sm font-medium">
            Docs
          </Link>
        </nav>
        <div className="flex items-center space-x-4">
          <UserNav />
        </div>
      </div>
    </div>
  );
}

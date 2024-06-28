import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function AccountTeams() {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
          <CardDescription>Manage the teams you belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <div className="relative">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search teams..." className="pl-8" />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

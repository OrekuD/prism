import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AccountGeneral() {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Display Name</CardTitle>
          <CardDescription>
            Enter your full name or preferred display name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Display Name" />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Username</CardTitle>
          <CardDescription>Your Prism URL namespace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Display Name" />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Email</CardTitle>
          <CardDescription>Your Prism email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Email" />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Select an avatar</CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <Input placeholder="Display Name" />
          </form>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button>Save</Button>
        </CardFooter>
      </Card>
      <Card className="border-destructive">
        <CardHeader className="gap-1">
          <CardTitle className="text-destructive">Delete Account</CardTitle>
          <CardDescription>Warning: Permanent Account Deletion</CardDescription>
          <CardDescription>
            This will irreversibly remove your Personal Account and all
            associated content from Prism.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t px-6 py-4">
          <Button variant="destructive">Delete my account</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

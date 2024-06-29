import React from "react";
import TeamSwitcher from "./team-switcher";
import { UserNav } from "./user-nav";
import { Link, useLocation } from "react-router-dom";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Label } from "./label";
import { Input } from "./input";
import { Button } from "./button";
import { Textarea } from "./textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const feedbackTypes = ["Bug", "Issue", "Improvement", "Feature"];

export function Nav() {
  const { pathname } = useLocation();

  return (
    <div className="border-b">
      <div className="flex h-16 items-center px-8 gap-6">
        {pathname === "/" ? null : (
          <Link to="/">
            <div className="size-7 rounded-full bg-yellow-600" />
          </Link>
        )}
        <TeamSwitcher />
        <nav className={"flex items-center space-x-4 lg:space-x-6 ml-auto"}>
          <Dialog>
            <DialogTrigger className="text-sm font-medium px-3 py-2 border rounded-sm">
              Feedback
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit Feedback</DialogTitle>
                <DialogDescription>
                  Submit a feedback on any issues, bugs, feautures or
                  improvement
                </DialogDescription>
              </DialogHeader>
              <div>
                <div className="space-y-4 py-2 pb-4">
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Feedback Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {feedbackTypes.map((feedbackType) => (
                        <SelectItem value={feedbackType} key={feedbackType}>
                          {feedbackType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Description"
                      className="max-h-32"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit">Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

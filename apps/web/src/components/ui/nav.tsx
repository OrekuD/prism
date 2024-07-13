import React from "react";
import { TeamSwitcher } from "./team-switcher";
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
    <div className="fixed top-0 z-50 border-b bg-background w-full flex flex-col h-32 px-4 gap-4 pt-3 md:gap-6 md:pt-0 md:h-16 md:px-8 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-4 lg:gap-6">
        {pathname === "/" ? null : (
          <Link to="/">
            <div className="size-7 rounded-full bg-yellow-600" />
          </Link>
        )}
        <TeamSwitcher />
      </div>
      <div className={"flex items-center gap-4 lg:gap-6"}>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Feedback</Button>
          </DialogTrigger>
          <DialogContent className="w-[90vw] md:w-full rounded-lg">
            <DialogHeader>
              <DialogTitle>Submit Feedback</DialogTitle>
              <DialogDescription>
                Submit a feedback on any issues, bugs, feautures or improvement
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
        <UserNav />
      </div>
    </div>
  );
}

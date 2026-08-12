import React from "react";
import { TeamSwitcher } from "./team-switcher";
import { UserNav } from "./user-nav";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PrismLogo } from "@/components/brand/prism-logo";

const VITE_DOCS_URL: string =
  import.meta.env.VITE_DOCS_URL ?? "http://localhost:3000";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";

const feedbackTypes = ["Bug", "Issue", "Improvement", "Feature"];

export function Nav() {
	const { pathname } = useLocation();

	return (
		<div className="sticky top-0 z-50 flex w-full flex-col gap-2 border-b border-border bg-background px-4 py-3 md:h-14 md:flex-row md:items-center md:justify-between md:gap-6 md:px-8 md:py-0">
			<div className="flex items-center gap-4 lg:gap-6">
				<Link
					to="/"
					aria-label="Prism home"
					className="-m-3 flex items-center p-3"
				>
					<PrismLogo size={20} />
				</Link>
				<TeamSwitcher />
			</div>
			<div className="flex h-full items-center gap-4 lg:gap-6">
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

				<Link
					to="/overview"
					className={cn(
						"relative flex h-full items-center text-sm font-medium transition-colors duration-150",
						pathname === "/overview"
							? "text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					Overview
					{pathname === "/overview" ? (
						<span
							aria-hidden="true"
							className="absolute inset-x-0 bottom-0 h-px bg-accent"
						/>
					) : null}
				</Link>
				<Link
					to="/projects"
					className={cn(
						"relative flex h-full items-center text-sm font-medium transition-colors duration-150",
						pathname.startsWith("/projects")
							? "text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					Projects
					{pathname.startsWith("/projects") ? (
						<span
							aria-hidden="true"
							className="absolute inset-x-0 bottom-0 h-px bg-accent"
						/>
					) : null}
				</Link>
				<a
					href={VITE_DOCS_URL}
					className="relative flex h-full items-center text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
				>
					Docs
				</a>
				<UserNav />
			</div>
		</div>
	);
}

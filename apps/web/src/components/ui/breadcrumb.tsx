import * as React from "react"
import { Slot as SlotPrimitive } from "radix-ui"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

function Breadcrumb({ ...props }: React.ComponentPropsWithoutRef<"nav"> & { separator?: React.ReactNode }) {
  return <nav aria-label="breadcrumb" {...props} />
}
Breadcrumb.displayName = "Breadcrumb"

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
        className,
      )}
      {...props}
    />
  )
}
BreadcrumbList.displayName = "BreadcrumbList"

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li className={cn("inline-flex items-center gap-1.5", className)} {...props} />
  )
}
BreadcrumbItem.displayName = "BreadcrumbItem"

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"a"> & {
  asChild?: boolean
}) {
  const Comp = (asChild ? (SlotPrimitive.Root as React.ElementType) : "a") as React.ElementType
  return (
    <Comp
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  )
}
BreadcrumbLink.displayName = "BreadcrumbLink"

function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  )
}
BreadcrumbPage.displayName = "BreadcrumbPage"

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  )
}
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn("flex h-9 w-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
    </span>
  )
}
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis"

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
}

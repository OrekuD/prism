"use client";

import type * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { XIcon } from "@/components/ui/lucide-icons";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
	return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
	return (
		<SheetPrimitive.Overlay
			data-slot="sheet-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=open]:fade-in-0",
				className,
			)}
			{...props}
		/>
	);
}

function SheetContent({
	className,
	children,
	side = "right",
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
	side?: "top" | "right" | "bottom" | "left";
	showCloseButton?: boolean;
}) {
	return (
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Content
				data-slot="sheet-content"
				className={cn(
					"fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:duration-200",
					side === "right" &&
						"inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
					side === "left" &&
						"inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
					side === "top" &&
						"inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
					side === "bottom" &&
						"inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
						<XIcon className="size-4" />
						<span className="sr-only">Close</span>
					</SheetPrimitive.Close>
				)}
			</SheetPrimitive.Content>
		</SheetPortal>
	);
}

type PresentationEntryMode = "forward" | "restore";

type PresentationSheetContentProps = Omit<
	React.ComponentProps<typeof SheetPrimitive.Content>,
	"asChild" | "forceMount"
> & {
	depth: number;
	entryMode?: PresentationEntryMode;
	isBaseLayer: boolean;
	isTop: boolean;
	layerIndex: number;
	open: boolean;
	onBackdropDismiss?: () => void;
	onExitComplete?: () => void;
	showCloseButton?: boolean;
};

const PRESENTATION_DEPTH = [
	{ scale: 1, x: 0 },
	{ scale: 0.97, x: -12 },
	{ scale: 0.94, x: -24 },
	{ scale: 0.91, x: -36 },
] as const;

const PRESENTATION_EASE_OUT = [0.23, 1, 0.32, 1] as const;

const presentationTransform = (depth: number, restore = false): string => {
	const state =
		PRESENTATION_DEPTH[Math.min(depth, PRESENTATION_DEPTH.length - 1)] ??
		PRESENTATION_DEPTH[0];
	const scale = restore ? state.scale * 0.99 : state.scale;
	return `translate3d(${state.x}px, 0, 0) scale(${scale})`;
};

/**
 * A route-backed sheet layer for nested presentation stacks. The top layer is
 * the only interactive dialog; parents remain mounted and readable, but inert.
 */
function PresentationSheetContent({
	className,
	children,
	depth,
	entryMode = "forward",
	isBaseLayer,
	isTop,
	layerIndex,
	open,
	onBackdropDismiss,
	onExitComplete,
	showCloseButton = false,
	style,
	...props
}: PresentationSheetContentProps) {
	const shouldReduceMotion = useReducedMotion();
	const effectiveDepth = shouldReduceMotion ? 0 : depth;
	const targetTransform = presentationTransform(effectiveDepth);
	const closedTransform = "translate3d(100%, 0, 0) scale(1)";
	const initialTransform =
		entryMode === "restore"
			? presentationTransform(effectiveDepth, true)
			: closedTransform;
	const contentZIndex = 61 + layerIndex * 2;
	const overlayZIndex = contentZIndex - 1;
	const overlayOpacity = isBaseLayer ? 0.58 : 0.12;
	const contentTransition = shouldReduceMotion
		? { duration: 0.15, ease: PRESENTATION_EASE_OUT }
		: {
				transform: {
					type: "spring" as const,
					stiffness: 300,
					damping: 28,
					mass: 0.9,
				},
				opacity: { duration: 0.15, ease: PRESENTATION_EASE_OUT },
			};

	return (
		<SheetPortal forceMount>
			{/* The backdrop is owned by the presentation layer and rendered for
			    EVERY sheet, not just the modal top. Radix's DialogOverlay returns
			    null for non-modal roots (the modal check gates before
			    forceMount), which used to unmount a parent's backdrop as soon as
			    a child sheet took the top slot. Rendering it directly keeps the
			    initial backdrop mounted and dimmed behind every nested layer. */}
			<motion.div
				aria-hidden="true"
				data-presentation-overlay=""
				className="fixed inset-0 bg-black"
				onPointerDown={(event) => {
					if (!isTop || !open || event.target !== event.currentTarget) return;
					event.preventDefault();
					onBackdropDismiss?.();
				}}
				initial={{ opacity: 0 }}
				animate={{ opacity: open ? overlayOpacity : 0 }}
				transition={{
					duration: shouldReduceMotion ? 0.15 : 0.18,
					ease: PRESENTATION_EASE_OUT,
				}}
				style={{
					zIndex: overlayZIndex,
					pointerEvents: isTop && open ? "auto" : "none",
				}}
			/>
			<SheetPrimitive.Content forceMount asChild {...props}>
				<motion.div
					data-presentation-depth={depth}
					data-presentation-layer=""
					data-presentation-top={isTop ? "true" : "false"}
					aria-hidden={isTop ? undefined : true}
					inert={isTop ? undefined : true}
					tabIndex={-1}
					className={cn(
						"fixed inset-y-0 right-0 flex h-full w-full origin-left flex-col gap-4 overflow-hidden border-l border-border bg-background shadow-[-20px_0_56px_rgb(0_0_0/0.24)] outline-none sm:max-w-[684px]",
						className,
					)}
					initial={{
						transform: shouldReduceMotion
							? entryMode === "restore"
								? targetTransform
								: closedTransform
							: initialTransform,
						opacity: entryMode === "restore" && !shouldReduceMotion ? 0 : 1,
					}}
					animate={{
						transform: open ? targetTransform : closedTransform,
						opacity:
							open || entryMode !== "restore" || shouldReduceMotion ? 1 : 0,
					}}
					transition={contentTransition}
					onAnimationComplete={() => {
						if (!open) onExitComplete?.();
					}}
					style={{
						...style,
						zIndex: contentZIndex,
						pointerEvents: isTop && open ? "auto" : "none",
					}}
				>
					{children}
					{showCloseButton ? (
						<SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
							<XIcon className="size-4" />
							<span className="sr-only">Close</span>
						</SheetPrimitive.Close>
					) : null}
				</motion.div>
			</SheetPrimitive.Content>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-header"
			className={cn("flex flex-col gap-1.5 p-4", className)}
			{...props}
		/>
	);
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn("mt-auto flex flex-col gap-2 p-4", className)}
			{...props}
		/>
	);
}

function SheetTitle({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn(
				"font-sans text-[16px] font-semibold leading-snug tracking-[-0.015em] text-text",
				className,
			)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn(
				"font-sans text-[13px] leading-[1.5] text-text-muted",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetTrigger,
	SheetClose,
	SheetContent,
	PresentationSheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};

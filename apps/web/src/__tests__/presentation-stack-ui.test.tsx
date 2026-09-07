import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PresentationStack } from "@/components/ui/presentation-stack";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { SheetTitle } from "@/components/ui/sheet";

const items = Array.from({ length: 4 }, (_, index) => ({
	key: `layer-${index + 1}`,
	parentPath: index === 0 ? "/errors" : `/errors/layer-${index}`,
}));

describe("PresentationStack", () => {
	it("mounts only the newest three sheets and makes only the top interactive", () => {
		render(
			<PresentationStack
				items={items}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		const sheets = document.querySelectorAll<HTMLElement>(
			"[data-presentation-layer]",
		);
		expect(sheets).toHaveLength(3);
		expect(
			Array.from(sheets).map((sheet) => ({
				key: sheet.dataset.presentationKey,
				depth: sheet.dataset.presentationDepth,
				top: sheet.dataset.presentationTop,
			})),
		).toEqual([
			{ key: "layer-2", depth: "2", top: "false" },
			{ key: "layer-3", depth: "1", top: "false" },
			{ key: "layer-4", depth: "0", top: "true" },
		]);
		expect(sheets[0]).toHaveAttribute("inert");
		expect(sheets[0]).toHaveAttribute("aria-hidden", "true");
		expect(sheets[0]?.style.borderRadius).toBe("");
		expect(sheets[1]).toHaveAttribute("inert");
		expect(sheets[1]?.style.borderRadius).toBe("");
		expect(sheets[2]).not.toHaveAttribute("inert");
		expect(sheets[2]).not.toHaveAttribute("aria-hidden");
	});

	it("keeps the DOM window capped while the newest sheet exits", () => {
		const { rerender } = render(
			<PresentationStack
				items={items}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		rerender(
			<PresentationStack
				items={items.slice(0, 3)}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		const sheets = document.querySelectorAll<HTMLElement>(
			"[data-presentation-layer]",
		);
		expect(sheets).toHaveLength(3);
		expect(
			Array.from(sheets).map((sheet) => sheet.dataset.presentationKey),
		).toEqual(["layer-2", "layer-3", "layer-4"]);
		expect(sheets[2]).toHaveAttribute("data-state", "closed");
	});

	it("keeps the final sheet mounted for its exit at the base URL", () => {
		const { rerender } = render(
			<PresentationStack
				items={items.slice(0, 1)}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		rerender(
			<PresentationStack
				items={items.slice(0, 0)}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		const sheet = document.querySelector<HTMLElement>(
			"[data-presentation-layer]",
		);
		expect(sheet).toHaveAttribute("data-presentation-key", "layer-1");
		expect(sheet).toHaveAttribute("data-state", "closed");
	});

	it("routes Escape dismissal through the top stack item only", () => {
		const onDismiss = vi.fn();
		render(
			<PresentationStack
				items={items.slice(0, 2)}
				onDismiss={onDismiss}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledWith(items[1]);
	});

	it("routes a top backdrop press through one-level dismissal", () => {
		const onDismiss = vi.fn();
		render(
			<PresentationStack
				items={items.slice(0, 2)}
				onDismiss={onDismiss}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		const overlays = document.querySelectorAll<HTMLElement>(
			"[data-presentation-overlay]",
		);
		const topOverlay = overlays[overlays.length - 1];
		expect(topOverlay).toBeDefined();
		if (!topOverlay) return;
		fireEvent.pointerDown(topOverlay, { button: 0, ctrlKey: false });
		fireEvent.click(topOverlay);

		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledWith(items[1]);
	});

	it("keeps the parent backdrop mounted when a child sheet mounts on top", () => {
		// Radix's DialogOverlay renders null for non-modal roots, which used
		// to unmount the parent's backdrop the moment a nested sheet took the
		// top slot. Every layer owns its backdrop; only the top is
		// interactive.
		render(
			<PresentationStack
				items={items.slice(0, 2)}
				onDismiss={() => undefined}
				renderItem={(item) => <SheetTitle>{item.key}</SheetTitle>}
			/>,
		);

		const overlays = document.querySelectorAll<HTMLElement>(
			"[data-presentation-overlay]",
		);
		expect(overlays).toHaveLength(2);
		expect(overlays[0]?.style.pointerEvents).toBe("none");
		expect(overlays[overlays.length - 1]?.style.pointerEvents).toBe("auto");
	});

	it("renders a nested popover above the active sheet", () => {
		render(
			<PresentationStack
				items={items.slice(0, 1)}
				onDismiss={() => undefined}
				renderItem={(item) => (
					<>
						<SheetTitle>{item.key}</SheetTitle>
						<Popover>
							<PopoverTrigger asChild>
								<button type="button">More copy options</button>
							</PopoverTrigger>
							<PopoverContent>Copy as Markdown</PopoverContent>
						</Popover>
					</>
				)}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "More copy options" }));

		const sheet = document.querySelector<HTMLElement>(
			"[data-presentation-layer]",
		);
		const popover = screen
			.getByText("Copy as Markdown")
			.closest<HTMLElement>("[data-slot='popover-content']");
		expect(popover).toHaveAttribute("data-state", "open");
		expect(Number(popover?.style.zIndex)).toBeGreaterThan(
			Number(sheet?.style.zIndex),
		);
	});
});

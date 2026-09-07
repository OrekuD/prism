import React from "react";

import { PresentationSheetContent, Sheet } from "@/components/ui/sheet";

export type PresentationStackItem = {
	key: string;
	parentPath: string;
};

type RenderedPresentationItem<T extends PresentationStackItem> = {
	depth: number;
	entryMode: "forward" | "restore";
	isTop: boolean;
	item: T;
	open: boolean;
};

type PresentationStackProps<T extends PresentationStackItem> = {
	items: T[];
	onDismiss: (item: T) => void;
	renderItem: (item: T) => React.ReactNode;
};

const MAXIMUM_VISIBLE_SHEETS = 3;

const sameKeys = <T extends PresentationStackItem>(left: T[], right: T[]) =>
	left.length === right.length &&
	left.every(
		(item, index) =>
			item.key === right[index]?.key &&
			item.parentPath === right[index]?.parentPath,
	);

const isPrefix = <T extends PresentationStackItem>(prefix: T[], full: T[]) =>
	prefix.length <= full.length &&
	prefix.every((item, index) => item.key === full[index]?.key);

const visibleItems = <T extends PresentationStackItem>(items: T[]): T[] =>
	items.slice(-MAXIMUM_VISIBLE_SHEETS);

const renderOpenItems = <T extends PresentationStackItem>(
	items: T[],
	previouslyRendered = new Set<string>(),
): RenderedPresentationItem<T>[] => {
	const visible = visibleItems(items);
	return visible.map((item, index) => ({
		depth: visible.length - index - 1,
		entryMode:
			index === visible.length - 1 && !previouslyRendered.has(item.key)
				? "forward"
				: "restore",
		isTop: index === visible.length - 1,
		item,
		open: true,
	}));
};

/**
 * Generic n-deep presentation stack with a three-sheet DOM window. Routing is
 * owned by the caller: changing `items` pushes or pops visual sheet layers.
 */
export function PresentationStack<T extends PresentationStackItem>({
	items,
	onDismiss,
	renderItem,
}: PresentationStackProps<T>) {
	const initialItems = React.useRef(items);
	const previousItemsRef = React.useRef(initialItems.current);
	const pendingItemsRef = React.useRef<T[] | null>(null);
	const returnFocusRef = React.useRef(new Map<string, HTMLElement>());
	const [rendered, setRendered] = React.useState<RenderedPresentationItem<T>[]>(
		() => renderOpenItems(initialItems.current),
	);

	React.useLayoutEffect(() => {
		const previousItems = previousItemsRef.current;
		if (sameKeys(previousItems, items)) return;

		const isSinglePop =
			previousItems.length === items.length + 1 &&
			isPrefix(items, previousItems);

		if (isSinglePop) {
			const outgoing = previousItems[previousItems.length - 1];
			if (!outgoing) return;
			pendingItemsRef.current = items;
			setRendered((current) => {
				const outgoingRendered = current.find(
					(entry) => entry.item.key === outgoing.key,
				);
				if (!outgoingRendered) {
					pendingItemsRef.current = null;
					return renderOpenItems(
						items,
						new Set(current.map((entry) => entry.item.key)),
					);
				}

				const targetVisible = visibleItems(items);
				const currentWithoutOutgoing = current
					.filter((entry) => entry.item.key !== outgoing.key)
					.map((entry) => entry.item);
				const targetAndOutgoing = new Set([
					...targetVisible.map((item) => item.key),
					outgoing.key,
				]);
				const baseItems =
					targetAndOutgoing.size <= MAXIMUM_VISIBLE_SHEETS
						? targetVisible
						: currentWithoutOutgoing;
				const knownKeys = new Set(current.map((entry) => entry.item.key));
				const baseRendered = renderOpenItems(baseItems, knownKeys).map(
					(entry) => ({ ...entry, isTop: false }),
				);

				return [
					...baseRendered,
					{
						...outgoingRendered,
						depth: 0,
						isTop: true,
						open: false,
					},
				];
			});
		} else {
			pendingItemsRef.current = null;
			const activeElement = document.activeElement;
			const nextTop = items[items.length - 1];
			const explicitTrigger = nextTop
				? Array.from(
						document.querySelectorAll<HTMLElement>(
							"[data-presentation-trigger]",
						),
					).find(
						(element) => element.dataset.presentationTrigger === nextTop.key,
					)
				: undefined;
			if (
				items.length > previousItems.length &&
				nextTop &&
				(explicitTrigger ||
					(activeElement instanceof HTMLElement &&
						activeElement !== document.body))
			) {
				returnFocusRef.current.set(
					nextTop.key,
					explicitTrigger ?? (activeElement as HTMLElement),
				);
			}
			setRendered((current) =>
				renderOpenItems(items, new Set(current.map((entry) => entry.item.key))),
			);
		}

		previousItemsRef.current = items;
	}, [items]);

	const finishExit = React.useCallback((outgoingKey: string) => {
		const pendingItems = pendingItemsRef.current;
		if (!pendingItems) return;
		pendingItemsRef.current = null;
		setRendered((current) =>
			renderOpenItems(
				pendingItems,
				new Set(current.map((entry) => entry.item.key)),
			),
		);

		const returnTarget = returnFocusRef.current.get(outgoingKey);
		returnFocusRef.current.delete(outgoingKey);
		if (returnTarget?.isConnected) {
			requestAnimationFrame(() => returnTarget.focus());
		}
	}, []);

	return (
		<>
			{rendered.map((entry, index) => (
				<Sheet
					key={entry.item.key}
					modal={entry.isTop && entry.open}
					open={entry.open}
					onOpenChange={(open) => {
						if (!open && entry.isTop && entry.open) onDismiss(entry.item);
					}}
				>
					<PresentationSheetContent
						data-presentation-key={entry.item.key}
						depth={entry.depth}
						entryMode={entry.entryMode}
						isBaseLayer={index === 0}
						isTop={entry.isTop}
						layerIndex={index}
						open={entry.open}
						onBackdropDismiss={() => {
							if (entry.isTop && entry.open) onDismiss(entry.item);
						}}
						onExitComplete={() => finishExit(entry.item.key)}
						showCloseButton={false}
						className="gap-0 p-0"
					>
						{renderItem(entry.item)}
					</PresentationSheetContent>
				</Sheet>
			))}
		</>
	);
}

import {
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
} from "@/components/ui/hugeicons";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { Table as TanstackTable } from "@tanstack/react-table";

/**
 * shadcn/ui data-table pagination footer (TanStack Table v8).
 *
 * Renders page-size select + prev/next/first/last controls and the
 * "x of y row(s)" counter. The table instance owns pagination state; this
 * component only renders it (v2 tokens, mono numerals).
 */
export function DataTablePagination<TData>({
	table,
	totalRows,
}: {
	table: TanstackTable<TData>;
	/** Unfiltered total for "of N" when server/client filters hide rows. */
	totalRows?: number;
}) {
	const pageSize = table.getState().pagination.pageSize;
	const pageIndex = table.getState().pagination.pageIndex;
	const pageCount = table.getPageCount();
	const filteredCount = table.getFilteredRowModel().rows.length;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-0.5 pt-3">
			<div className="flex flex-1 items-center gap-3 text-[12px] text-text-muted">
				<span className="font-mono tabular-nums">
					{filteredCount === 0
						? "0 events"
						: `${pageIndex * pageSize + 1}–${Math.min((pageIndex + 1) * pageSize, filteredCount)} of ${filteredCount}`}
					{totalRows !== undefined && totalRows !== filteredCount
						? ` · ${totalRows} loaded`
						: ""}
				</span>
			</div>
			<div className="flex items-center gap-4 sm:gap-6 lg:gap-8">
				<div className="flex items-center gap-2">
					<span className="hidden font-mono text-[11px] text-text-subtle sm:inline">
						Rows per page
					</span>
					<Select
						value={String(pageSize)}
						onValueChange={(value) => table.setPageSize(Number(value))}
					>
						<SelectTrigger className="h-[32px] w-[72px] font-mono text-[12px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent side="top">
							{[10, 25, 50, 100, 200].map((size) => (
								<SelectItem key={size} value={String(size)}>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-1.5">
					<span className="whitespace-nowrap px-1 font-mono text-[12px] tabular-nums text-text-muted">
						Page {pageCount > 0 ? pageIndex + 1 : 0} of {Math.max(pageCount, 1)}
					</span>
					<Button
						variant="outline"
						size="icon-sm"
						className="hidden size-8 lg:flex"
						onClick={() => table.setPageIndex(0)}
						disabled={!table.getCanPreviousPage()}
						aria-label="Go to first page"
					>
						<ChevronsLeft />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						className="size-8"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
						aria-label="Go to previous page"
					>
						<ChevronLeft />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						className="size-8"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
						aria-label="Go to next page"
					>
						<ChevronRight />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						className="hidden size-8 lg:flex"
						onClick={() => table.setPageIndex(pageCount - 1)}
						disabled={!table.getCanNextPage()}
						aria-label="Go to last page"
					>
						<ChevronsRight />
					</Button>
				</div>
			</div>
		</div>
	);
}

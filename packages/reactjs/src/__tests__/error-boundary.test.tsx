import type { PrismErrorReporter } from "@prism-analytics/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismErrorBoundary } from "../index";

/**
 * @prism-analytics/react PrismErrorBoundary tests (task-15 slice 3b): the
 * OPT-IN class boundary captures render/lifecycle errors into an
 * already-created reporter with `handled: true` and a bounded component
 * stack. It never rethrows, never installs anything globally, and a
 * failing reporter never breaks the boundary.
 */

function fakeReporter(): {
	reporter: PrismErrorReporter;
	spy: ReturnType<typeof vi.fn>;
} {
	const spy = vi.fn(() => ({ status: "queued" as const, id: "e-1" }));
	return {
		reporter: { captureException: spy } as unknown as PrismErrorReporter,
		spy,
	};
}

function Boom(): ReactNode {
	throw new Error("boundary boom");
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("PrismErrorBoundary", () => {
	it("captures a render error into the reporter and shows the fallback", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { reporter, spy } = fakeReporter();

		render(
			<PrismErrorBoundary
				reporter={reporter}
				fallback={(error) => <div>fallback: {error.message}</div>}
			>
				<Boom />
			</PrismErrorBoundary>,
		);

		expect(screen.getByText(/boundary boom/)).toBeDefined();
		expect(spy).toHaveBeenCalledTimes(1);
		const [input] = spy.mock.calls[0] as [
			{
				exception: { type: string; message: string };
				handled: boolean;
				context: { extras: Record<string, unknown> };
			},
		];
		expect(input.exception.type).toBe("Error");
		expect(input.exception.message).toBe("boundary boom");
		expect(input.handled).toBe(true);
		expect(input.context.extras.boundary).toBe("PrismErrorBoundary");
		expect(typeof input.context.extras.componentStack).toBe("string");
		errorSpy.mockRestore();
	});

	it("renders a static fallback node without a function", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { reporter, spy } = fakeReporter();
		render(
			<PrismErrorBoundary reporter={reporter} fallback={<p>static fallback</p>}>
				<Boom />
			</PrismErrorBoundary>,
		);
		expect(screen.getByText("static fallback")).toBeDefined();
		expect(spy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it("reset() re-renders the subtree (fallback-recovered)", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { reporter, spy } = fakeReporter();
		let armed = true;
		function Flaky(): ReactNode {
			if (armed) throw new Error("only once");
			return <p>recovered</p>;
		}

		render(
			<PrismErrorBoundary
				reporter={reporter}
				fallback={(_error, reset) => (
					<button
						type="button"
						onClick={() => {
							armed = false;
							reset();
						}}
					>
						retry
					</button>
				)}
			>
				<Flaky />
			</PrismErrorBoundary>,
		);

		// the armed flag survives React dev-mode double renders, so the pre-click
		// subtree really is the fallback
		expect(screen.getByText("retry")).toBeDefined();
		expect(screen.queryByText("recovered")).toBeNull();
		fireEvent.click(screen.getByText("retry"));
		expect(screen.getByText("recovered")).toBeDefined();
		expect(spy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it("calls onCapture as a side-effect hook", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { reporter } = fakeReporter();
		const onCapture = vi.fn();
		render(
			<PrismErrorBoundary reporter={reporter} onCapture={onCapture}>
				<Boom />
			</PrismErrorBoundary>,
		);
		expect(onCapture).toHaveBeenCalledTimes(1);
		const [error] = onCapture.mock.calls[0] as [Error];
		expect(error.message).toBe("boundary boom");
		errorSpy.mockRestore();
	});

	it("a throwing reporter never breaks the boundary", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const throwing = {
			captureException: vi.fn(() => {
				throw new Error("reporter is broken");
			}),
		} as unknown as PrismErrorReporter;

		render(
			<PrismErrorBoundary reporter={throwing} fallback={<p>still renders</p>}>
				<Boom />
			</PrismErrorBoundary>,
		);
		expect(screen.getByText("still renders")).toBeDefined();
		expect(throwing.captureException).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it("renders children unchanged when nothing throws", () => {
		const { reporter, spy } = fakeReporter();
		function Fine(): ReactNode {
			const [state, setState] = useState(0);
			return (
				<button type="button" onClick={() => setState(state + 1)}>
					count {state}
				</button>
			);
		}
		render(
			<PrismErrorBoundary reporter={reporter}>
				<Fine />
			</PrismErrorBoundary>,
		);
		expect(screen.getByText("count 0")).toBeDefined();
		fireEvent.click(screen.getByText("count 0"));
		expect(screen.getByText("count 1")).toBeDefined();
		expect(spy).not.toHaveBeenCalled();
	});
});

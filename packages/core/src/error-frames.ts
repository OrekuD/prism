import type { ErrorFrame } from "./error-contract";

/**
 * Runtime-neutral stack-frame parsing (task-15 slice 3b).
 *
 * Pure string logic: no DOM, V8 globals, or platform APIs. Browser stacks
 * are parsed here so BOTH the browser adapter (`@prism-analytics/browser`)
 * and the React boundary (`@prism-analytics/react`) share one parser
 * instead of drifting. The ingestion server re-sanitizes/re-computes
 * frames anyway — this is a best-effort presentation + fingerprint
 * enrichment, never a security boundary.
 */

/**
 * Parse a browser stack string into bounded frames. Handles V8
 * ("at fn (url:line:col)" and "at url:line:col") plus Firefox/Safari
 * ("fn@url:line:col"). Unrecognized lines (eval, native code, headers)
 * are skipped, never fabricated.
 */
export function framesFromStack(
	stack: string | undefined,
	maxFrames = 32,
): ErrorFrame[] {
	const frames: ErrorFrame[] = [];
	if (!stack || typeof stack !== "string") return frames;
	for (const rawLine of stack.split(/\n/)) {
		if (frames.length >= maxFrames) break;
		const line = rawLine.trim();
		if (!line || (line.startsWith("Error") && line.includes(":"))) continue;
		let file: string | undefined;
		let fn: string | undefined;
		let ln: number | undefined;
		let col: number | undefined;
		// V8 with a function: "at fn (url:line:col)". The GREEDY function
		// capture is anchored by the space+paren, so "https:" can never
		// split into a bogus frame.
		const v8Paren = line.match(/^at\s+(.+)\s+\((.+?):(\d+)(?::(\d+))?\)$/);
		if (v8Paren) {
			const head = (v8Paren[1] ?? "").trim();
			if (head && head !== "unknown") fn = head;
			file = (v8Paren[2] ?? "").trim();
			ln = Number(v8Paren[3]);
			col = v8Paren[4] ? Number(v8Paren[4]) : undefined;
		} else {
			// V8 anonymous: "at url:line:col"
			const v8Flat = line.match(/^at\s+(.+?):(\d+)(?::(\d+))?$/);
			if (v8Flat) {
				file = (v8Flat[1] ?? "").trim();
				ln = Number(v8Flat[2]);
				col = v8Flat[3] ? Number(v8Flat[3]) : undefined;
			} else {
				// Firefox / Safari: "fn@url:line:col"
				const ff = line.match(/^(.+?)@(.+?):(\d+)(?::(\d+))?$/);
				if (!ff) continue;
				const head = (ff[1] ?? "").trim();
				if (head && head !== "anonymous" && !head.startsWith("global code"))
					fn = head;
				file = (ff[2] ?? "").trim();
				ln = Number(ff[3]);
				col = ff[4] ? Number(ff[4]) : undefined;
			}
		}
		if (!Number.isFinite(ln)) ln = undefined;
		if (col !== undefined && !Number.isFinite(col)) col = undefined;
		if (file && /<anonymous>|\[native code\]|eval at/.test(file)) continue;
		frames.push({
			file: file || undefined,
			function: fn,
			line: ln,
			column: col,
			inApp: isInAppFrame(file, fn),
		});
	}
	return frames;
}

/** Conservative in-app heuristic — the server re-sanitizes/re-computes. */
function isInAppFrame(
	file: string | undefined,
	fn: string | undefined,
): boolean {
	if (!file) return false;
	if (
		/node_modules|webpack[\\/]|vendor[\\/.]|bower_components|\.min\.css|\.min\.js|extension:\/\/|chrome-extension|moz-extension|safari-web-extension/.test(
			file,
		)
	)
		return false;
	return !fn || !/[.<]/.test(fn) || fn.length < 40;
}

/**
 * Convert an `Error`-like value (any object with name/message/stack) into
 * a fully populated exception body for an `ErrorReportInput`.
 */
export function errorToException(value: unknown): {
	type: string;
	message: string;
	frames?: ErrorFrame[];
} {
	const record = (
		typeof value === "object" && value !== null
			? (value as { name?: unknown; message?: unknown; stack?: unknown })
			: {}
	) as { name?: unknown; message?: unknown; stack?: unknown };
	const name = typeof record.name === "string" ? record.name : "Error";
	const message =
		typeof record.message === "string" && record.message.length > 0
			? record.message
			: String(value ?? name);
	const stack = typeof record.stack === "string" ? record.stack : undefined;
	return {
		type: name && name.length > 0 ? name : "Error",
		message: message.length > 2048 ? `${message.slice(0, 2048)}…` : message,
		...(stack ? { frames: framesFromStack(stack) } : {}),
	};
}

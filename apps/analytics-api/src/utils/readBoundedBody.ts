/**
 * Bounded request-body reader (review F5, shared by the analytics and
 * error ingestion paths): counts bytes WHILE reading the stream and
 * cancels immediately at the ceiling, so no request path allocates or
 * parses more than the configured body limit — regardless of
 * client-supplied Content-Length. Works in Node and Worker-compatible
 * runtimes (ReadableStream + TextDecoder).
 */
export async function readBoundedBody(
	stream: ReadableStream<Uint8Array> | null,
	limitBytes: number,
): Promise<{ ok: true; body: string } | { ok: false; reason: "too-large" }> {
	if (!stream) {
		return { ok: false, reason: "too-large" };
	}
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limitBytes) {
				await reader.cancel().catch(() => undefined);
				return { ok: false, reason: "too-large" };
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, body: new TextDecoder().decode(merged) };
}

/** Bound bytes before decoding, including chunked requests without Content-Length. */
export async function readLiveBody(req: Request, maximum: number): Promise<string | null> {
	if (!req.body) return "";
	const reader = req.body.getReader(); const decoder = new TextDecoder();
	let bytes = 0; let body = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) return body + decoder.decode();
			bytes += value.byteLength;
			if (bytes > maximum) { await reader.cancel(); return null; }
			body += decoder.decode(value, { stream: true });
		}
	} finally { reader.releaseLock(); }
}

/** Note chunking shared by the application and native-Node backfills. */
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_NOTE = 24;

export function chunkNoteText(title: string, plainText: string): string[] {
	const body = plainText.trim();
	const heading = title.trim();
	if (!body && !heading) return [];
	if (!body) return [heading];
	const chunks: string[] = [];
	let start = 0;
	while (start < body.length && chunks.length < MAX_CHUNKS_PER_NOTE) {
		let end = Math.min(start + CHUNK_SIZE, body.length);
		if (end < body.length) {
			const window = body.slice(start, end);
			const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
			if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1;
		}
		const piece = body.slice(start, end).trim();
		if (piece) chunks.push(heading ? `${heading}\n\n${piece}` : piece);
		if (end >= body.length) break;
		start = end - CHUNK_OVERLAP;
	}
	return chunks;
}

import "server-only";

import { Worker } from "node:worker_threads";
import { normalizeSourceText, titleFromFilename } from "@/lib/beta/projects/projects-rules";
import type { PdfWorkerInput, PdfWorkerResult } from "@/lib/beta/projects/pdf-worker";

/**
 * Text from a file a founder uploads into a study project, read on the server
 * (docs/beta/projects.md). PDFs go through unpdf, the serverless build of
 * Mozilla's PDF.js with its worker inlined (no native dependency), on a worker
 * thread of their own (pdf-worker.ts); text and Markdown are read as UTF-8.
 * Only the text is kept, as the source's body; the file itself is not stored
 * anywhere.
 */

/** Under Vercel's 4.5 MB request body limit, with room for the form encoding. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_MAX_PAGES = 400;
/** Well inside the upload route's 60 s maxDuration. */
const PDF_TIMEOUT_MS = 25_000;

export class UploadError extends Error {}

export type UploadKind = "pdf" | "text";

/** What a file is, from its type and name; null for anything this does not read. */
export function uploadKind(filename: string, mediaType: string): UploadKind | null {
	const extension = filename.toLowerCase().split(".").pop() ?? "";
	const type = mediaType.toLowerCase().split(";")[0].trim();
	if (type === "application/pdf" || extension === "pdf") return "pdf";
	if (["txt", "md", "markdown", "text"].includes(extension) || type === "text/plain" || type === "text/markdown") return "text";
	return null;
}

export interface ExtractedSource {
	title: string;
	text: string;
	truncated: boolean;
	pages: number | null;
}

/**
 * PDF.js parses as one unbroken chain of promise callbacks, so on the request's
 * own thread no timer fires until it ends (LC-17642 review: a 150 KB file whose
 * page inflates to 150 MB ran 50 s). It runs in a worker thread instead, which
 * the deadline terminates, stopping the parse wherever it is.
 */
function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
	if (new TextDecoder("latin1").decode(bytes.slice(0, 1024)).indexOf("%PDF-") < 0) {
		return Promise.reject(new UploadError("That file is not a PDF."));
	}
	return new Promise((resolve, reject) => {
		// Keep the URL literal and the chunk name: webpack bundles the worker
		// from it, and next.config.mjs traces chunks/pdf-worker.js by that name.
		const worker = new Worker(/* webpackChunkName: "pdf-worker" */ new URL("./pdf-worker", import.meta.url), {
			workerData: { bytes, maxPages: PDF_MAX_PAGES } satisfies PdfWorkerInput,
		});
		const timer = setTimeout(() => settle(new UploadError("This PDF took too long to read. Try a smaller file, or paste the part you need.")), PDF_TIMEOUT_MS);
		// The first outcome wins, and the worker is stopped whichever it is.
		function settle(outcome: Error | { text: string; pages: number }) {
			clearTimeout(timer);
			void worker.terminate();
			if (outcome instanceof Error) reject(outcome);
			else resolve(outcome);
		}
		worker.once("message", (result: PdfWorkerResult) => settle(result.ok ? { text: result.text, pages: result.pages } : new UploadError(refusal(result))));
		// The worker itself failing (it could not load, say) is not the file's
		// fault, so it stays a plain error that projectError logs as a 500. `on`,
		// not `once`: an 'error' with no listener would throw on this thread.
		worker.on("error", settle);
		worker.once("exit", () => settle(new UploadError("This PDF could not be read.")));
	});
}

function refusal(result: Exclude<PdfWorkerResult, { ok: true }>): string {
	if (result.reason === "pages") return `This PDF has ${result.pages} pages. Upload up to ${PDF_MAX_PAGES} pages, or just the chapter you need.`;
	if (result.reason === "password") return "This PDF is password protected. Open it and paste the text instead.";
	return "This PDF could not be read.";
}

/** Read an uploaded file's text. Throws UploadError with a message for the founder. */
export async function extractUpload(file: { name: string; type: string; size: number; bytes: Uint8Array }): Promise<ExtractedSource> {
	if (file.size === 0 || file.bytes.byteLength === 0) throw new UploadError("That file is empty.");
	if (file.size > UPLOAD_MAX_BYTES || file.bytes.byteLength > UPLOAD_MAX_BYTES) throw new UploadError("Upload a file up to 4 MB.");
	const kind = uploadKind(file.name, file.type);
	if (!kind) throw new UploadError("Upload a PDF, or a .txt or .md text file.");

	let raw: string;
	let pages: number | null = null;
	if (kind === "pdf") {
		const result = await pdfText(file.bytes);
		raw = result.text;
		pages = result.pages;
	} else {
		if (file.bytes.includes(0)) throw new UploadError("That file is not plain text.");
		try {
			raw = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
		} catch {
			throw new UploadError("Text files must be saved as UTF-8.");
		}
	}
	const { text, truncated } = normalizeSourceText(raw);
	if (text.replace(/\s/g, "").length < 20) {
		throw new UploadError(kind === "pdf" ? "This PDF has no text to read (it may be scanned pages). Paste the text instead." : "That file has no text in it.");
	}
	return { title: titleFromFilename(file.name), text, truncated, pages };
}

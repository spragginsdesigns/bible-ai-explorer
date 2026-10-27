import "server-only";

import { extractText, getResolvedPDFJS } from "unpdf";
import { normalizeSourceText, titleFromFilename } from "@/lib/beta/projects/projects-rules";

/**
 * Text from a file a founder uploads into a study project, read on the server
 * (docs/beta/projects.md). PDFs go through unpdf, the serverless build of
 * Mozilla's PDF.js with its worker inlined (no native dependency); text and
 * Markdown are read as UTF-8. Only the text is kept, as the source's body; the
 * file itself is not stored anywhere.
 */

/** Under Vercel's 4.5 MB request body limit, with room for the form encoding. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_MAX_PAGES = 400;
/** The serverless PDF.js parses on the event loop, so an untrusted file gets a deadline. */
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

/** Race `promise` against a deadline; on the deadline, `onTimeout` stops the work behind it. */
function withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				onTimeout();
				reject(new UploadError("This PDF took too long to read. Try a smaller file, or paste the part you need."));
			}, ms);
		}),
	]).finally(() => clearTimeout(timer));
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
	if (new TextDecoder("latin1").decode(bytes.slice(0, 1024)).indexOf("%PDF-") < 0) {
		throw new UploadError("That file is not a PDF.");
	}
	// The loading task is held here (unpdf's getDocumentProxy hides it) so a
	// deadline can destroy it, which stops PDF.js instead of leaving it parsing.
	const { getDocument } = await getResolvedPDFJS();
	const task = getDocument({ data: bytes, useSystemFonts: true });
	const stop = () => void task.destroy().catch(() => undefined);
	try {
		const pdf = await withDeadline(task.promise, PDF_TIMEOUT_MS, stop);
		if (pdf.numPages > PDF_MAX_PAGES) throw new UploadError(`This PDF has ${pdf.numPages} pages. Upload up to ${PDF_MAX_PAGES} pages, or just the chapter you need.`);
		const { text } = await withDeadline(extractText(pdf, { mergePages: false }), PDF_TIMEOUT_MS, stop);
		return { text: text.map((page) => page.trim()).filter(Boolean).join("\n\n"), pages: pdf.numPages };
	} catch (error) {
		if (error instanceof UploadError) throw error;
		const name = error instanceof Error ? error.name : "";
		throw new UploadError(name === "PasswordException" ? "This PDF is password protected. Open it and paste the text instead." : "This PDF could not be read.");
	} finally {
		stop();
	}
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

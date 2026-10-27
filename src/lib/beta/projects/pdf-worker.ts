import { parentPort, workerData } from "node:worker_threads";
import { definePDFJSModule, extractText, getResolvedPDFJS } from "unpdf";

/**
 * Reads one uploaded PDF on a worker thread, which `pdfText` (extract.ts)
 * terminates at its deadline. Webpack bundles this file as its own server
 * chunk, `pdf-worker.js`, which next.config.mjs traces into the upload route.
 */

export interface PdfWorkerInput {
	bytes: Uint8Array;
	maxPages: number;
}

export type PdfWorkerResult =
	| { ok: true; text: string; pages: number }
	| { ok: false; reason: "pages"; pages: number }
	| { ok: false; reason: "password" | "unreadable" };

async function read({ bytes, maxPages }: PdfWorkerInput): Promise<PdfWorkerResult> {
	// Eager keeps PDF.js inside this worker's chunk; a lazy chunk of its own
	// would be missing from the route's trace. unpdf still installs its
	// browser-global stubs before PDF.js first runs.
	await definePDFJSModule(() => import(/* webpackMode: "eager" */ "unpdf/pdfjs"));
	const { getDocument } = await getResolvedPDFJS();
	const task = getDocument({ data: bytes, useSystemFonts: true });
	try {
		const pdf = await task.promise;
		if (pdf.numPages > maxPages) return { ok: false, reason: "pages", pages: pdf.numPages };
		const { text } = await extractText(pdf, { mergePages: false });
		return { ok: true, text: text.map((page) => page.trim()).filter(Boolean).join("\n\n"), pages: pdf.numPages };
	} catch (error) {
		return { ok: false, reason: error instanceof Error && error.name === "PasswordException" ? "password" : "unreadable" };
	} finally {
		void task.destroy().catch(() => undefined);
	}
}

read(workerData as PdfWorkerInput).then(
	(result) => parentPort?.postMessage(result),
	() => parentPort?.postMessage({ ok: false, reason: "unreadable" } satisfies PdfWorkerResult),
);

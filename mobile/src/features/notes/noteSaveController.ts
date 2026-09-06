import { createNoteSaveQueue } from "./noteSaveQueue";

export interface NoteSaveController {
	enqueue: () => Promise<void>;
	flush: () => Promise<boolean>;
	/** Mark content as already persisted and invalidate an older capture. */
	replaceContent: (html: string) => void;
	lastChance: () => Promise<void>;
}

/** Coordinates WebView captures with ordered PATCHes for one note editor. */
export function createNoteSaveController(
	initialHtml: string,
	capture: () => Promise<string | null>,
	save: (html: string) => Promise<void>,
	onCaptureError?: (message: string) => void
): NoteSaveController {
	let savedHtml = initialHtml;
	let latestHtml = initialHtml;
	let generation = 0;
	const enqueueJob = createNoteSaveQueue();

	const persist = async (html: string, jobGeneration: number) => {
		if (jobGeneration !== generation) return;
		latestHtml = html;
		if (html === savedHtml) return;
		await save(html);
		if (jobGeneration === generation) savedHtml = html;
	};

	const enqueue = () =>
		enqueueJob(async () => {
			const jobGeneration = generation;
			const html = await capture();
			if (jobGeneration !== generation) return;
			if (html === null) {
				const message = "The editor did not respond. Your note is still open; try saving again.";
				onCaptureError?.(message);
				throw new Error(message);
			}
			await persist(html, jobGeneration);
		});

	return {
		enqueue,
		flush: async () => {
			try {
				await enqueue();
				return true;
			} catch {
				return false;
			}
		},
		replaceContent: (html) => {
			generation += 1;
			savedHtml = html;
			latestHtml = html;
		},
		lastChance: () => enqueueJob(() => persist(latestHtml, generation)),
	};
}

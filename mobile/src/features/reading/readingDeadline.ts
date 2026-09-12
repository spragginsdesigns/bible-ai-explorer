/** Bound the entire save, including auth token and response-body awaits.
 * Late token resolution must check live() before starting a network request. */
export const READING_SEND_DEADLINE_MS = 15_000;
export function withReadingDeadline<T>(
	operation: (live: () => boolean, signal: AbortSignal) => Promise<T>,
	timeoutMs = READING_SEND_DEADLINE_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let live = true;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			live = false;
			controller.abort();
			reject(
				Object.assign(
					new Error(
						"Reading sync timed out. Your reading is still saved on this device.",
					),
					{ isTimeout: true },
				),
			);
		}, timeoutMs);
		Promise.resolve()
			.then(() => operation(() => live, controller.signal))
			.then(
				(value) => {
					if (!live) return;
					live = false;
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					if (!live) return;
					live = false;
					clearTimeout(timer);
					reject(error);
				},
			);
	});
}

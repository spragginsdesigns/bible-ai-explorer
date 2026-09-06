/**
 * Run asynchronous note saves in submission order while allowing a failed
 * job to be retried by the next caller.
 */
export function createNoteSaveQueue() {
	let tail = Promise.resolve();

	return function enqueue<T>(job: () => Promise<T>): Promise<T> {
		const run = tail.then(job);
		// Keep the queue usable after a rejected request, while preserving the
		// rejection on the promise returned to the caller.
		tail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	};
}

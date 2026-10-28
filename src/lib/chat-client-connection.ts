/**
 * Observe the client-facing body after the SDK has teed off its server drain.
 * Cancelling that branch must record departure without stopping generation.
 */
export function createChatClientConnection(signal: AbortSignal) {
	let disconnected = false;
	let settled = false;
	let resolveDeparture!: (departed: boolean) => void;
	const departure = new Promise<boolean>((resolve) => { resolveDeparture = resolve; });
	let notification: Promise<void> | undefined;
	const settleDeparture = (departed: boolean) => {
		if (settled) return;
		settled = true;
		disconnected = departed;
		signal.removeEventListener("abort", onAbort);
		resolveDeparture(departed);
	};
	const onAbort = () => settleDeparture(true);
	signal.addEventListener("abort", onAbort, { once: true });
	if (signal.aborted) onAbort();

	return {
		get disconnected(): boolean {
			return disconnected;
		},

		/** Call only after a successful save; retain this promise in waitUntil. */
		afterPersistence(notify: () => Promise<void>): Promise<void> {
			// Either event can arrive first. A normal EOF/error settles false;
			// departure settles true and waits for persistence to register this.
			notification ??= departure.then(async (departed) => {
				if (departed) await notify();
			});
			return notification;
		},

		trackResponse(response: Response): Response {
			if (!response.body) {
				settleDeparture(false);
				return response;
			}
			const reader = response.body.getReader();
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				async pull(controller) {
					try {
						const result = await reader.read();
						if (cancelled) return;
						if (result.done) {
							settleDeparture(false);
							controller.close();
							reader.releaseLock();
						} else {
							controller.enqueue(result.value);
						}
					} catch (error) {
						if (cancelled) return;
						settleDeparture(false);
						controller.error(error);
						reader.releaseLock();
					}
				},
				cancel(reason) {
					// A tee branch's cancellation promise can wait for the other
					// reader. Record this synchronously, before awaiting that drain.
					settleDeparture(true);
					cancelled = true;
					return reader.cancel(reason).finally(() => reader.releaseLock());
				},
			});
			return new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		},
	};
}

/**
 * Observe the final client-facing body after all server-side drain branches.
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

export type ChatClientConnection = ReturnType<typeof createChatClientConnection>;

/** Keep tracking outside middleware that tees or independently drains the body. */
export function withChatClientConnection(
	handler: (req: Request, connection: ChatClientConnection) => Promise<Response>,
) {
	return async (req: Request): Promise<Response> => {
		const connection = createChatClientConnection(req.signal);
		const response = await handler(req, connection);
		return connection.trackResponse(response);
	};
}

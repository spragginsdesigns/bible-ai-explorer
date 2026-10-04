"use client";

/**
 * One passive observer on `window.fetch`, shared by the analytics listeners.
 *
 * The web app has no single API client the way Android has `apiJson`: dozens
 * of components call `fetch("/api/...")` directly. Wrapping the global once is
 * the only place every one of those calls passes through. The wrapper is
 * strictly pass-through: it calls the real fetch with the caller's exact
 * arguments, returns the caller's exact promise, never reads a successful
 * body, and a listener that throws is swallowed rather than allowed to touch
 * the request.
 */

export interface ObservedFetch {
	/** The absolute request URL. */
	url: string;
	/** The request body when it was sent as a string, else null. */
	body: string | null;
	/** The abort signal's reason when the request was aborted. */
	signalReason: unknown;
	/** Set when the request produced a response, of any status. */
	response?: Response;
	/** Set when the request rejected. */
	error?: unknown;
}

type Listener = (observed: ObservedFetch) => void;

const listeners = new Set<Listener>();
let installed = false;

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return new URL(input, window.location.href).toString();
	if (input instanceof URL) return input.toString();
	return input.url;
}

function install(): void {
	if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
	installed = true;
	const original = window.fetch;

	window.fetch = function observedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const pending = original.call(window, input, init);
		if (listeners.size === 0) return pending;

		let url: string;
		try {
			url = requestUrl(input);
		} catch {
			return pending;
		}
		const body = typeof init?.body === "string" ? init.body : null;
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

		const notify = (partial: Pick<ObservedFetch, "response" | "error">) => {
			const observed: ObservedFetch = { url, body, signalReason: signal?.aborted ? signal.reason : undefined, ...partial };
			for (const listener of listeners) {
				try {
					listener(observed);
				} catch {
					// A listener is analytics; the request is the product.
				}
			}
		};
		// Both handlers are attached to a branch, so the caller's own promise
		// keeps its exact resolution and its rejection stays the caller's to handle.
		pending.then(
			(response) => notify({ response }),
			(error: unknown) => notify({ error })
		);
		return pending;
	};
}

/** Observe every fetch until the returned function is called. */
export function observeFetch(listener: Listener): () => void {
	install();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

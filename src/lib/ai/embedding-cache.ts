import { createHash } from "node:crypto";

/** Cancellation requests cooperation; this deadline also bounds a non-settling provider. */
export function withAbortDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			const error = new DOMException("Embedding deadline exceeded.", "TimeoutError");
			controller.abort(error);
			reject(error);
		}, timeoutMs);
		Promise.resolve().then(() => operation(controller.signal)).then(resolve, reject).finally(() => clearTimeout(timer));
	});
}

/** Bounded process cache. Only digests and vectors are retained, never query text. */
export class EmbeddingCache {
	private readonly entries = new Map<string, { vector: number[]; expiresAt: number }>();
	private readonly pending = new Map<string, Promise<number[]>>();
	readonly stats = { hits: 0, misses: 0, joined: 0 };
	private readonly capacity: number;
	private readonly ttlMs: number;
	private readonly clock: () => number;
	private readonly maxPending: number;

	constructor(
		capacity = 128,
		ttlMs = 10 * 60 * 1000,
		clock: () => number = Date.now,
		maxPending = 32,
	) {
		this.capacity = capacity;
		this.ttlMs = ttlMs;
		this.clock = clock;
		this.maxPending = maxPending;
	}

	async get(namespace: string, query: string, load: () => Promise<number[]>, signal?: AbortSignal): Promise<number[]> {
		signal?.throwIfAborted();
		const key = createHash("sha256").update(JSON.stringify([namespace, query])).digest("hex");
		const cached = this.entries.get(key);
		if (cached && cached.expiresAt > this.clock()) {
			this.entries.delete(key);
			this.entries.set(key, cached);
			this.stats.hits++;
			return cached.vector.slice();
		}
		if (cached) this.entries.delete(key);
		let job = this.pending.get(key);
		if (job) this.stats.joined++;
		else {
			if (this.pending.size >= this.maxPending) throw new Error("Embedding queue is full.");
			this.stats.misses++;
			job = Promise.resolve().then(load).then(vector => {
				if (!vector.length || vector.some(value => !Number.isFinite(value))) throw new Error("Invalid embedding.");
				const retained = vector.slice();
				this.entries.set(key, { vector: retained, expiresAt: this.clock() + this.ttlMs });
				while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
				return retained;
			}).finally(() => this.pending.delete(key));
			this.pending.set(key, job);
		}
		// Each caller owns its wait. Cancelling it must not poison a shared load.
		return new Promise((resolve, reject) => {
			const abort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			job!.then(vector => resolve(vector.slice()), reject).finally(() => signal?.removeEventListener("abort", abort));
		});
	}
}

import { describe, expect, it, vi } from "vitest";
import { predictLearnReview, LearnReviewFailure, LearnSyncStore, learnStorageKey, type LearnStorage } from "./learnSync";
import type { LearnCard, LearnReviewAcknowledgement, LearnReviewOperation, LearnToday } from "./learn";

class MemoryStorage implements LearnStorage {
	readonly values = new Map<string, string>();
	writes = 0;
	failWrites = new Set<number>();
	private blockedWrites = new Map<number, Promise<void>>();
	private blockedStarts = new Map<number, () => void>();

	async getItem(key: string): Promise<string | null> {
		return this.values.get(key) ?? null;
	}

	async setItem(key: string, value: string): Promise<void> {
		this.writes += 1;
		this.blockedStarts.get(this.writes)?.();
		await this.blockedWrites.get(this.writes);
		if (this.failWrites.has(this.writes)) throw new Error("disk full");
		this.values.set(key, value);
	}

	blockNextWrite(): { started: Promise<void>; release(): void } {
		const write = this.writes + 1;
		let release!: () => void;
		let markStarted!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { markStarted = resolve; });
		this.blockedWrites.set(write, gate);
		this.blockedStarts.set(write, markStarted);
		return {
			started,
			release: () => {
				this.blockedWrites.delete(write);
				this.blockedStarts.delete(write);
				release();
			},
		};
	}
}

const reviewedAt = "2026-09-12T18:00:00.000Z";
const timezone = "America/Los_Angeles";

function card(id: string, revision = 0): LearnCard {
	return {
		id,
		revision,
		book: id === "a" ? 43 : 45,
		chapter: id === "a" ? 3 : 8,
		verse: id === "a" ? 16 : 28,
		translation: "KJV",
		reference: id === "a" ? "John 3:16" : "Romans 8:28",
		text: id === "a" ? "For God so loved the world" : "And we know that all things work together for good",
		stage: 0,
		intervalDays: 0,
		dueAt: "2026-09-12T07:00:00.000Z",
		knownAt: null,
	};
}

function today(cards: LearnCard[]): LearnToday {
	return { cards, knownCount: 0, queueCount: cards.length };
}

function acknowledgement(
	before: LearnCard,
	payload: LearnReviewOperation,
	replayed = false,
): LearnReviewAcknowledgement {
	return {
		operationId: payload.operationId,
		appliedRevision: payload.expectedRevision + 1,
		replayed,
		currentCard: predictLearnReview(before, payload.result, payload.reviewedAt, payload.timezone),
	};
}

function createHarness(options: {
	userId?: string;
	storage?: MemoryStorage;
	serverToday?: LearnToday;
	send?: (cardId: string, payload: LearnReviewOperation) => Promise<LearnReviewAcknowledgement>;
	fetch?: () => Promise<LearnToday>;
	now?: () => Date;
	timezone?: () => string;
} = {}) {
	const userId = options.userId ?? "user-a";
	const storage = options.storage ?? new MemoryStorage();
	let serverToday = options.serverToday ?? today([card("a"), card("b")]);
	let uuid = 0;
	const sends: Array<{ cardId: string; payload: LearnReviewOperation }> = [];
	const send = options.send ?? (async (cardId: string, payload: LearnReviewOperation) => {
		const before = serverToday.cards.find((item) => item.id === cardId);
		if (!before) throw new LearnReviewFailure("missing", { code: "missing" });
		const receipt = acknowledgement(before, payload);
		serverToday = {
			...serverToday,
			cards: serverToday.cards.map((item) => item.id === cardId ? receipt.currentCard! : item),
		};
		return receipt;
	});
	const store = new LearnSyncStore(userId, {
		storage,
		fetchToday: options.fetch ?? (async () => serverToday),
		sendReview: async (cardId, payload) => {
			sends.push({ cardId, payload });
			return send(cardId, payload);
		},
		createOperationId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
		now: options.now ?? (() => new Date(reviewedAt)),
		timezone: options.timezone ?? (() => timezone),
	});
	return {
		store,
		storage,
		sends,
		setServerToday(value: LearnToday) { serverToday = value; },
		getServerToday() { return serverToday; },
	};
}

async function hydrateWithToday(harness: ReturnType<typeof createHarness>): Promise<void> {
	await harness.store.hydrate();
	await harness.store.installToday(harness.getServerToday());
}

describe("LearnSyncStore", () => {
	it("can restart its subscription lifecycle on the same Strict Mode store", async () => {
		const harness = createHarness({ serverToday: today([card("a")]) });
		const firstSnapshots: number[] = [];
		const unsubscribe = harness.store.subscribe((snapshot) => firstSnapshots.push(snapshot.pendingCount));
		await hydrateWithToday(harness);
		unsubscribe();
		harness.store.dispose();

		const remountedSnapshots: number[] = [];
		harness.store.activate();
		const unsubscribeRemount = harness.store.subscribe((snapshot) => remountedSnapshots.push(snapshot.pendingCount));
		await harness.store.hydrate();
		await harness.store.enqueue("a", "good");

		expect(firstSnapshots.length).toBeGreaterThan(1);
		expect(remountedSnapshots.at(-1)).toBe(1);
		unsubscribeRemount();
	});

	it("serializes a delayed same-account write across an unmount and remount", async () => {
		const storage = new MemoryStorage();
		const first = createHarness({ userId: "same-user", storage, serverToday: today([card("a")]) });
		await hydrateWithToday(first);
		const blocked = storage.blockNextWrite();
		const enqueue = first.store.enqueue("a", "good");
		await blocked.started;
		first.store.dispose();

		const remounted = createHarness({ userId: "same-user", storage, serverToday: today([card("a")]) });
		const hydrate = remounted.store.hydrate();
		blocked.release();
		const payload = await enqueue;
		await hydrate;

		expect(remounted.store.getSnapshot().pendingCount).toBe(1);
		expect(storage.values.get(learnStorageKey("same-user"))).toContain(payload.operationId);
	});

	it("does not send or claim a review when the enqueue write fails", async () => {
		const harness = createHarness();
		await hydrateWithToday(harness);
		harness.storage.failWrites.add(harness.storage.writes + 1);

		await expect(harness.store.enqueue("a", "good")).rejects.toThrow(/Nothing was sent/i);
		await harness.store.synchronize({ refresh: false });

		expect(harness.sends).toHaveLength(0);
		expect(harness.store.getSnapshot()).toMatchObject({ pendingCount: 0 });
		expect(harness.store.getSnapshot().today?.cards[0]).toMatchObject({ id: "a", revision: 0, stage: 0 });
	});

	it("persists an acknowledgement before removing it or sending a dependent review", async () => {
		const harness = createHarness({ serverToday: today([card("a")]) });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("a", "good");
		// The next write stores the first receipt. The following removal fails,
		// which models a process exit after the receipt is durable.
		harness.storage.failWrites.add(harness.storage.writes + 2);
		await harness.store.synchronize({ refresh: false });

		expect(harness.sends.map((item) => item.payload.expectedRevision)).toEqual([0]);
		expect(harness.store.getSnapshot().pendingCount).toBe(2);

		harness.storage.failWrites.clear();
		const resumed = createHarness({
			storage: harness.storage,
			serverToday: harness.getServerToday(),
		});
		await resumed.store.hydrate();
		await resumed.store.synchronize({ refresh: false });

		expect(resumed.sends.map((item) => item.payload.expectedRevision)).toEqual([1]);
		expect(resumed.store.getSnapshot().pendingCount).toBe(0);
		expect(resumed.store.getSnapshot().today?.cards[0]).toMatchObject({ revision: 2, stage: 2 });
	});

	it("replays each card in revision order", async () => {
		const harness = createHarness();
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("b", "good");

		expect(harness.store.getSnapshot().today?.cards).toMatchObject([
			{ id: "a", revision: 2, stage: 2 },
			{ id: "b", revision: 1, stage: 1 },
		]);
		await harness.store.synchronize({ refresh: false });

		expect(harness.sends.map((item) => [item.cardId, item.payload.expectedRevision])).toEqual([
			["a", 0],
			["a", 1],
			["b", 0],
		]);
		expect(harness.store.getSnapshot().pendingCount).toBe(0);
	});

	it("blocks dependent reviews on conflict while an independent card continues", async () => {
		const currentA = { ...card("a", 5), stage: 2 as const };
		const send = vi.fn(async (cardId: string, payload: LearnReviewOperation) => {
			if (cardId === "a") {
				throw new LearnReviewFailure("revision_conflict", {
					code: "revision_conflict",
					currentCard: currentA,
				});
			}
			return acknowledgement(card("b"), payload);
		});
		const harness = createHarness({ send });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("b", "good");

		await harness.store.synchronize({ refresh: false });

		expect(send.mock.calls.map(([id, payload]) => [id, payload.expectedRevision])).toEqual([
			["a", 0],
			["b", 0],
		]);
		expect(harness.store.getSnapshot().conflicts).toMatchObject([
			{ cardId: "a", code: "revision_conflict" },
		]);
		expect(harness.store.getSnapshot().pendingCount).toBe(2);

		harness.setServerToday(today([currentA, { ...card("b"), revision: 1, stage: 1 }]));
		await harness.store.useLatestSchedule("a");
		expect(harness.store.getSnapshot().pendingCount).toBe(0);
		expect(harness.store.getSnapshot().today?.cards[0]).toMatchObject({ id: "a", revision: 5, stage: 2 });
	});

	it("keeps a reused-ID conflict until latest-schedule recovery succeeds", async () => {
		let fetchFails = true;
		const harness = createHarness({
			serverToday: today([card("a")]),
			send: async () => {
				throw new LearnReviewFailure("operation_id_reused", {
					code: "operation_id_reused",
					currentCard: null,
				});
			},
			fetch: async () => {
				if (fetchFails) throw new LearnReviewFailure("offline", { offline: true });
				return today([]);
			},
		});
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");
		await harness.store.synchronize({ refresh: false });

		await harness.store.useLatestSchedule("a");
		expect(harness.store.getSnapshot()).toMatchObject({ pendingCount: 1, connection: "offline" });

		fetchFails = false;
		await harness.store.useLatestSchedule("a");
		expect(harness.store.getSnapshot()).toMatchObject({ pendingCount: 0, conflicts: [] });
		expect(harness.store.getSnapshot().downloadedCards).toEqual([]);
	});

	it("retries a lost response with the exact operation and accepts the duplicate receipt", async () => {
		let applied: LearnReviewAcknowledgement | null = null;
		let firstPayload: LearnReviewOperation | null = null;
		const send = vi.fn(async (_cardId: string, payload: LearnReviewOperation) => {
			if (!applied) {
				firstPayload = payload;
				applied = acknowledgement(card("a"), payload);
				throw new LearnReviewFailure("connection lost", { offline: true });
			}
			expect(payload).toEqual(firstPayload);
			return { ...applied, replayed: true };
		});
		const harness = createHarness({ serverToday: today([card("a")]), send });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");

		await harness.store.synchronize({ refresh: false });
		expect(harness.store.getSnapshot()).toMatchObject({ connection: "offline", pendingCount: 1 });
		await harness.store.synchronize({ refresh: false });

		expect(send).toHaveBeenCalledTimes(2);
		expect(harness.sends[1].payload).toEqual(harness.sends[0].payload);
		expect(harness.store.getSnapshot().pendingCount).toBe(0);
		expect(harness.store.getSnapshot().today?.cards[0]).toMatchObject({ revision: 1, stage: 1 });
	});

	it("isolates persisted sessions and ignores an old account's late result", async () => {
		const storage = new MemoryStorage();
		let resolveFirst!: (value: LearnReviewAcknowledgement) => void;
		const firstResponse = new Promise<LearnReviewAcknowledgement>((resolve) => {
			resolveFirst = resolve;
		});
		const first = createHarness({
			userId: "user-a",
			storage,
			serverToday: today([card("a")]),
			send: async () => firstResponse,
		});
		await hydrateWithToday(first);
		const payload = await first.store.enqueue("a", "good");
		const oldSync = first.store.synchronize({ refresh: false });
		await vi.waitFor(() => expect(first.sends).toHaveLength(1));
		first.store.dispose();

		const second = createHarness({ userId: "user-b", storage, serverToday: today([card("b")]) });
		await hydrateWithToday(second);
		resolveFirst(acknowledgement(card("a"), payload));
		await oldSync;

		expect(learnStorageKey("user-a")).not.toBe(learnStorageKey("user-b"));
		expect(second.store.getSnapshot()).toMatchObject({ pendingCount: 0 });
		expect(second.store.getSnapshot().today?.cards[0]).toMatchObject({ id: "b", revision: 0 });
		expect(storage.values.get(learnStorageKey("user-a"))).toContain(payload.operationId);
	});

	it("uses a receipt's newer current card without changing a queued payload", async () => {
		const newer = { ...card("a", 3), stage: 3 as const };
		const send = vi.fn(async (_cardId: string, payload: LearnReviewOperation) => ({
			operationId: payload.operationId,
			appliedRevision: 1,
			replayed: true,
			currentCard: newer,
		}));
		const harness = createHarness({ serverToday: today([card("a")]), send });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");

		await harness.store.synchronize({ refresh: false });

		expect(harness.store.getSnapshot().today?.cards[0]).toMatchObject({ revision: 3, stage: 3 });
		expect(harness.store.getSnapshot().pendingCount).toBe(0);
	});

	it("does not send a dependent review after a receipt reports a newer revision", async () => {
		const newer = { ...card("a", 3), stage: 3 as const };
		const send = vi.fn(async (_cardId: string, payload: LearnReviewOperation) => ({
			operationId: payload.operationId,
			appliedRevision: 1,
			replayed: true,
			currentCard: newer,
		}));
		const harness = createHarness({ serverToday: today([card("a")]), send });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");
		await harness.store.enqueue("a", "good");

		await harness.store.synchronize({ refresh: false });

		expect(send).toHaveBeenCalledTimes(1);
		expect(harness.store.getSnapshot().pendingCount).toBe(1);
		expect(harness.store.getSnapshot().conflicts).toMatchObject([
			{ cardId: "a", code: "revision_conflict", operationCount: 1 },
		]);
	});

	it("removes a newer deferred receipt even when the following refresh is offline", async () => {
		const newerTomorrow = {
			...card("a", 3),
			stage: 3 as const,
			intervalDays: 1,
			dueAt: "2026-09-13T07:00:00.000Z",
		};
		const harness = createHarness({
			serverToday: today([card("a")]),
			send: async (_cardId, payload) => ({
				operationId: payload.operationId,
				appliedRevision: 1,
				replayed: true,
				currentCard: newerTomorrow,
			}),
			fetch: async () => { throw new LearnReviewFailure("offline", { offline: true }); },
		});
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");

		await harness.store.synchronize();

		expect(harness.store.getSnapshot()).toMatchObject({ connection: "offline", pendingCount: 0 });
		expect(harness.store.getSnapshot().today?.cards).toEqual([]);
		expect(harness.store.getSnapshot().downloadedCards[0]).toMatchObject({ id: "a", revision: 3 });
	});

	it("keeps a completed card out today and restores it from cache tomorrow offline", async () => {
		const storage = new MemoryStorage();
		const recall = { ...card("a"), stage: 3 as const };
		const first = createHarness({
			userId: "rollover-user",
			storage,
			serverToday: today([recall]),
			now: () => new Date("2026-09-12T18:00:00.000Z"),
		});
		await hydrateWithToday(first);
		await first.store.enqueue("a", "good");
		await first.store.synchronize({ refresh: false });

		expect(first.store.getSnapshot().today?.cards).toEqual([]);
		expect(first.store.getSnapshot().downloadedCards[0]).toMatchObject({
			id: "a",
			revision: 1,
			dueAt: "2026-09-13T07:00:00.000Z",
		});
		first.store.dispose();

		const tomorrow = createHarness({
			userId: "rollover-user",
			storage,
			serverToday: today([]),
			now: () => new Date("2026-09-13T18:00:00.000Z"),
			fetch: async () => { throw new LearnReviewFailure("offline", { offline: true }); },
		});
		await tomorrow.store.hydrate();

		expect(tomorrow.store.getSnapshot().today?.cards[0]).toMatchObject({
			id: "a",
			revision: 1,
			stage: 3,
		});
	});

	it("restores tomorrow's predicted card without changing its pending operation", async () => {
		const storage = new MemoryStorage();
		const recall = { ...card("a"), stage: 3 as const };
		const first = createHarness({
			userId: "pending-rollover-user",
			storage,
			serverToday: today([recall]),
			now: () => new Date("2026-09-12T18:00:00.000Z"),
		});
		await hydrateWithToday(first);
		const payload = await first.store.enqueue("a", "good");
		expect(first.store.getSnapshot().today?.cards).toEqual([]);
		first.store.dispose();

		const tomorrow = createHarness({
			userId: "pending-rollover-user",
			storage,
			serverToday: today([]),
			now: () => new Date("2026-09-13T18:00:00.000Z"),
		});
		await tomorrow.store.hydrate();

		expect(tomorrow.store.getSnapshot()).toMatchObject({ pendingCount: 1 });
		expect(tomorrow.store.getSnapshot().today?.cards[0]).toMatchObject({
			id: "a",
			revision: 1,
			stage: 3,
		});
		expect(storage.values.get(learnStorageKey("pending-rollover-user"))).toContain(payload.operationId);
	});

	it("predicts the next local midnight across the fall DST boundary", () => {
		const recall = { ...card("a"), stage: 3 as const };
		const predicted = predictLearnReview(
			recall,
			"good",
			"2026-11-01T08:30:00.000Z",
			"America/Los_Angeles",
		);

		expect(predicted.dueAt).toBe("2026-11-02T08:00:00.000Z");
	});

	it("accepts a replay receipt whose card was deleted after the review", async () => {
		const send = vi.fn(async (_cardId: string, payload: LearnReviewOperation) => ({
			operationId: payload.operationId,
			appliedRevision: 1,
			replayed: true,
			currentCard: null,
		}));
		const harness = createHarness({ serverToday: today([card("a")]), send });
		await hydrateWithToday(harness);
		await harness.store.enqueue("a", "good");

		await harness.store.synchronize({ refresh: false });

		expect(harness.store.getSnapshot().pendingCount).toBe(0);
		expect(harness.store.getSnapshot().today?.cards).toEqual([]);
		expect(harness.store.getSnapshot().downloadedCards).toEqual([]);
	});
});

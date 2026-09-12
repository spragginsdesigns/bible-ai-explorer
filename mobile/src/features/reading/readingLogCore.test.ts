import { describe, it, expect, vi } from "vitest";
import {
	ReadingJournal,
	compactVerses,
	chapterEventId,
	retryDelay,
	SESSION_IDLE_MS,
	VerseDwellTracker,
	VERSE_DWELL_MS,
	type KeyValueStorage,
	type ReadingEntry,
} from "./readingLogCore";
class MemoryStorage implements KeyValueStorage {
	data = new Map<string, string>();
	failWrite = false;
	async getItem(k: string) {
		return this.data.get(k) ?? null;
	}
	async setItem(k: string, v: string) {
		if (this.failWrite) throw new Error("disk full");
		this.data.set(k, v);
	}
	async removeItem(k: string) {
		this.data.delete(k);
	}
	async getAllKeys() {
		return [...this.data.keys()];
	}
}
const morning = Date.parse("2026-09-12T08:00:00Z");
const input = (now = morning, verses = [1, 2, 3]) => ({
	book: 43,
	chapter: 1,
	translation: "KJV",
	verses,
	verseCount: 3,
	now,
	timezone: "America/Los_Angeles",
});
function setup() {
	const storage = new MemoryStorage();
	let id = 0;
	const uuid = () =>
		`aaaaaaaa-bbbb-4ccc-8ddd-${(++id).toString().padStart(12, "0")}`;
	return { storage, uuid, journal: new ReadingJournal(storage, "alice", uuid) };
}
describe("durable reading journal", () => {
	it("logs morning and night rereads as separate sessions, compactly", async () => {
		const { journal } = setup();
		const sent: ReadingEntry[] = [];
		for (let chapter = 1; chapter <= 3; chapter++)
			await journal.record({ ...input(), chapter });
		await journal.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		for (let chapter = 1; chapter <= 3; chapter++)
			await journal.record({ ...input(morning + 12 * 3600_000), chapter });
		await journal.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		expect(sent).toHaveLength(6);
		expect(new Set(sent.map((e) => e.sessionId)).size).toBe(2);
		expect(sent.every((e) => e.completed)).toBe(true);
	});
	it("updates one event for overlapping coverage, and revisits do not inflate reads", async () => {
		const { journal } = setup();
		const sent: ReadingEntry[] = [];
		await journal.record(input(morning, [1, 2]));
		await journal.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		await journal.record(input(morning + 10_000, [2, 3]));
		await journal.record(input(morning + 20_000, [1, 2, 3]));
		await journal.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		expect(sent.map((e) => e.revision)).toEqual([1, 2]);
		expect(sent[0].completed).toBe(false);
		expect(sent[1].completed).toBe(true);
		expect(sent[1].verseRanges).toEqual([{ start: 1, end: 3 }]);
		expect(sent[0].eventId).toBe(sent[1].eventId);
	});
	it("replays same identity after server accepted but response was lost and process restarts", async () => {
		const { journal, storage, uuid } = setup();
		await journal.record(input());
		let accepted: ReadingEntry | undefined;
		await expect(
			journal.flush(
				async (e) => {
					accepted = e;
					throw new Error("lost acknowledgement");
				},
				() => true,
			),
		).rejects.toThrow();
		const restarted = new ReadingJournal(storage, "alice", uuid);
		const replay = vi.fn(async () => {});
		await restarted.flush(replay, () => true);
		expect(replay).toHaveBeenCalledWith(accepted);
		expect(restarted.status().pending).toBe(0);
		await restarted.record(input(morning + 20_000));
		await restarted.flush(replay, () => true);
		expect(replay).toHaveBeenCalledTimes(1);
	});
	it("retains unsynced old sessions, and removes synced old device rows", async () => {
		const { journal, storage } = setup();
		await journal.record(input());
		await journal.record(input(morning + SESSION_IDLE_MS + 1));
		expect(journal.status().pending).toBe(2);
		await journal.flush(
			async () => {},
			() => true,
		);
		expect(
			[...storage.data.keys()].filter((k) => k.includes("event:")),
		).toHaveLength(1);
	});
	it("does not send another account backlog; original account can resume later", async () => {
		const { journal, storage, uuid } = setup();
		await journal.record(input());
		const bob = new ReadingJournal(storage, "bob", uuid);
		const send = vi.fn(async () => {});
		await bob.flush(send, () => true);
		expect(send).not.toHaveBeenCalled();
		await journal.flush(send, () => false);
		expect(send).not.toHaveBeenCalled();
		await new ReadingJournal(storage, "alice", uuid).flush(send, () => true);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("stops between queued sends when user backgrounds or signs out", async () => {
		const { journal } = setup();
		await journal.record(input());
		await journal.record({ ...input(), chapter: 2 });
		let active = true;
		const send = vi.fn(async () => {
			active = false;
		});
		await journal.flush(send, () => active);
		expect(send).toHaveBeenCalledTimes(1);
		expect(journal.status().pending).toBe(1);
	});
	it("keeps a newer snapshot pending when older revision acknowledgement arrives", async () => {
		const { journal } = setup();
		await journal.record(input(morning, [1]));
		let done!: () => void;
		const gate = new Promise<void>((r) => (done = r));
		const inFlight = journal.flush(
			async () => gate,
			() => true,
		);
		await new Promise((r) => setTimeout(r, 0));
		await journal.record(input(morning + 1000, [2]));
		done();
		await inFlight;
		expect(journal.status().pending).toBe(1);
		const send = vi.fn(async (_entry: ReadingEntry) => {});
		await journal.flush(send, () => true);
		expect(send.mock.calls[0][0].revision).toBe(2);
	});
	it("does not claim durable success if local disk write fails", async () => {
		const { journal, storage } = setup();
		storage.failWrite = true;
		await expect(journal.record(input())).rejects.toThrow("disk full");
		expect(journal.status().error).toContain("storage");
		expect(journal.status().pending).toBe(0);
		storage.failWrite = false;
		await journal.record(input());
		expect(journal.status().pending).toBe(1);
	});
	it("provides deliberate retry for rejected entries without retrying forever", async () => {
		const { journal } = setup();
		await journal.record(input());
		await journal.flush(
			async () => {
				throw { status: 400 };
			},
			() => true,
		);
		expect(journal.status().blocked).toBe(1);
		const send = vi.fn(async () => {});
		await journal.flush(send, () => true);
		expect(send).not.toHaveBeenCalled();
		await journal.retryBlocked();
		await journal.flush(send, () => true);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("activity keeps long engaged reading in one session without counting duplicate coverage", async () => {
		const { journal } = setup();
		await journal.record(input());
		await journal.touch(morning + 20 * 60_000);
		await journal.touch(morning + 40 * 60_000);
		await journal.record({ ...input(morning + 45 * 60_000), chapter: 2 });
		const sessions = new Set<string>();
		await journal.flush(
			async (e) => {
				sessions.add(e.sessionId);
			},
			() => true,
		);
		expect(sessions.size).toBe(1);
	});
	it("keeps an expired session expired when first new activity occurs at night", async () => {
		const { journal } = setup();
		await journal.record(input());
		await journal.touch(morning + 12 * 3600_000);
		await journal.record(input(morning + 12 * 3600_000 + 8000));
		const sessions = new Set<string>();
		await journal.flush(
			async (e) => {
				sessions.add(e.sessionId);
			},
			() => true,
		);
		expect(sessions.size).toBe(2);
	});
	it("normalizes ranges and uses valid stable UUID identities", () => {
		expect(compactVerses([3, 1, 2, 2, 7, 8])).toEqual([
			{ start: 1, end: 3 },
			{ start: 7, end: 8 },
		]);
		expect(
			chapterEventId("aaaaaaaa-bbbb-4ccc-8ddd-000000000001", 43, 3),
		).toMatch(
			/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
		);
		expect(retryDelay(100, 1)).toBeLessThanOrEqual(360_000);
	});
});
describe("visible verse dwell", () => {
	it("does not mark a whole chapter from a five second open", () => {
		const d = new VerseDwellTracker();
		d.update([1, 2], 0);
		expect(d.due(5000)).toEqual([]);
		expect(d.due(VERSE_DWELL_MS)).toEqual([1, 2]);
		expect(d.nextDelay(VERSE_DWELL_MS)).toBeNull();
	});
	it("retains overlapping verse dwell while slow-scrolling", () => {
		const d = new VerseDwellTracker();
		d.update([1, 2], 0);
		d.update([2, 3], 5000);
		expect(d.due(8000)).toEqual([2]);
		expect(d.nextDelay(8000)).toBe(5000);
		expect(d.due(13000)).toEqual([3]);
	});
	it("never counts background or obscured time", () => {
		const d = new VerseDwellTracker();
		d.update([1, 2], 0);
		d.pause();
		expect(d.due(100000)).toEqual([]);
		d.update([1, 2], 100000);
		expect(d.due(105000)).toEqual([]);
		expect(d.due(108000)).toEqual([1, 2]);
	});
	it("does not run repetitive timers for a still viewport, and a new session can reread", () => {
		const d = new VerseDwellTracker();
		d.update([1], 0);
		d.due(8000);
		d.update([1], 12000);
		expect(d.nextDelay(12000)).toBeNull();
		d.reset();
		d.update([1], SESSION_IDLE_MS);
		expect(d.due(SESSION_IDLE_MS + 8000)).toEqual([1]);
	});
});

describe("browser tabs sharing a journal", () => {
	function shared() {
		const storage = new MemoryStorage();
		let tail: Promise<unknown> = Promise.resolve();
		const locked = Object.assign(storage, {
			exclusive<T>(job: () => Promise<T>) {
				const run = tail.then(job);
				tail = run.catch(() => {});
				return run;
			},
		});
		const a = new ReadingJournal(
			locked,
			"alice",
			() => "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
		);
		const b = new ReadingJournal(
			locked,
			"alice",
			() => "ffffffff-bbbb-4ccc-8ddd-000000000002",
		);
		return { a, b };
	}
	it("serializes snapshots from separate tabs without losing disjoint coverage", async () => {
		const { a, b } = shared();
		await Promise.all([a.initialize(), b.initialize()]);
		await Promise.all([
			a.record(input(morning, [1])),
			b.record(input(morning + 1000, [2])),
		]);
		const sent: ReadingEntry[] = [];
		await a.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0].verseRanges).toEqual([{ start: 1, end: 2 }]);
		expect(sent[0].revision).toBe(2);
	});
	it("does not overwrite another tab snapshot when an old network ack arrives", async () => {
		const { a, b } = shared();
		await a.record(input(morning, [1]));
		let done!: () => void;
		const gate = new Promise<void>((r) => (done = r));
		const sending = a.flush(
			async () => gate,
			() => true,
		);
		await new Promise((r) => setTimeout(r, 0));
		await b.record(input(morning + 1000, [2, 3]));
		done();
		await sending;
		const sent: ReadingEntry[] = [];
		await a.flush(
			async (e) => {
				sent.push(e);
			},
			() => true,
		);
		expect(sent[0].completed).toBe(true);
		expect(sent[0].revision).toBe(2);
	});
});

it("coalesces session activity persistence to avoid writes on every scroll event", async () => {
	const { journal, storage } = setup();
	await journal.record(input());
	const write = vi.spyOn(storage, "setItem");
	for (let offset = 1; offset < 10_000; offset += 100)
		await journal.touch(morning + offset);
	expect(write).not.toHaveBeenCalled();
	await journal.touch(morning + 10_000);
	expect(write).toHaveBeenCalledTimes(1);
});

it("bounds each replay pass so a large offline backlog yields between batches", async () => {
	const { journal } = setup();
	for (let chapter = 1; chapter <= 40; chapter++)
		await journal.record({ ...input(), book: 19, chapter });
	const send = vi.fn(async () => {});
	await journal.flush(send, () => true);
	expect(send).toHaveBeenCalledTimes(25);
	expect(journal.status().pending).toBe(15);
	await journal.flush(send, () => true);
	expect(send).toHaveBeenCalledTimes(40);
	expect(journal.status().pending).toBe(0);
});

it("keeps the original timezone with a chapter timestamp when the device zone changes", async () => {
	const { journal } = setup();
	const at = Date.parse("2026-01-02T01:00:00Z");
	await journal.record({ ...input(at, [1]), timezone: "UTC" });
	await journal.record({
		...input(at + 1000, [2]),
		timezone: "America/Los_Angeles",
	});
	const sent: ReadingEntry[] = [];
	await journal.flush(
		async (entry) => {
			sent.push(entry);
		},
		() => true,
	);
	expect(sent[0].occurredAt).toBe("2026-01-02T01:00:00.000Z");
	expect(sent[0].timezone).toBe("UTC");
	await journal.record({
		...input(at + SESSION_IDLE_MS + 1000, [1]),
		timezone: "America/Los_Angeles",
	});
	await journal.flush(
		async (entry) => {
			sent.push(entry);
		},
		() => true,
	);
	expect(sent[1].timezone).toBe("America/Los_Angeles");
	expect(sent[1].sessionId).not.toBe(sent[0].sessionId);
});

it("throttles browser storage reads before the shared lock with a large offline backlog", async () => {
	const storage = Object.assign(new MemoryStorage(), {
		exclusive: async <T>(job: () => Promise<T>) => job(),
	});
	const session = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
	storage.data.set(
		"sureword:reading:v1:alice:session",
		JSON.stringify({ id: session, lastActivity: morning }),
	);
	for (let chapter = 1; chapter <= 500; chapter++) {
		const entry = {
			...input(),
			eventId: `pending-${chapter}`,
			sessionId: session,
			revision: 1,
			source: "reader",
			occurredAt: new Date(morning).toISOString(),
			precision: "exact",
			completed: false,
			verseRanges: [{ start: 1, end: 1 }],
		};
		storage.data.set(
			`sureword:reading:v1:alice:event:${entry.eventId}`,
			JSON.stringify({ entry, syncedRevision: 0 }),
		);
	}
	const journal = new ReadingJournal(storage, "alice", () => session);
	await journal.initialize();
	const read = vi.spyOn(storage, "getItem");
	const enumerate = vi.spyOn(storage, "getAllKeys");
	const lock = vi.spyOn(storage, "exclusive");
	for (let offset = 1; offset < 10_000; offset += 100)
		await journal.touch(morning + offset);
	expect(read).not.toHaveBeenCalled();
	expect(enumerate).not.toHaveBeenCalled();
	expect(lock).not.toHaveBeenCalled();
	await journal.touch(morning + 10_000);
	expect(lock).toHaveBeenCalledTimes(1);
	expect(enumerate).toHaveBeenCalledTimes(1);
	expect(read).toHaveBeenCalledTimes(501);
	for (let offset = 10_001; offset < 20_000; offset += 100)
		await journal.touch(morning + offset);
	expect(enumerate).toHaveBeenCalledTimes(1);
});

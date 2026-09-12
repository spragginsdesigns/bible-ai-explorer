/** Pure reading journal logic, shared by tracking and durable replay tests. */
export const SESSION_IDLE_MS = 30 * 60_000;
export const VERSE_DWELL_MS = 8_000;
export type VerseRange = { start: number; end: number };
export interface ReadingEntry {
	eventId: string;
	sessionId: string;
	revision: number;
	source: "reader" | "physical" | "manual" | "legacy";
	book: number;
	chapter: number;
	translation: string;
	occurredAt: string;
	timezone: string;
	precision: string;
	completed: boolean;
	verseRanges: VerseRange[];
	bookName?: string;
	localDate?: string;
}
export function compactVerses(verses: Iterable<number>): VerseRange[] {
	const sorted = [...new Set(verses)]
		.filter((v) => Number.isInteger(v) && v > 0)
		.sort((a, b) => a - b);
	const ranges: VerseRange[] = [];
	for (const verse of sorted) {
		const last = ranges[ranges.length - 1];
		if (last && last.end + 1 === verse) last.end = verse;
		else ranges.push({ start: verse, end: verse });
	}
	return ranges;
}
export function coveredVerses(ranges: VerseRange[]): number[] {
	return ranges.flatMap((r) =>
		Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i),
	);
}
/** Same session/chapter keeps one identity across process death. Translation switches do not count a reread. */
export function chapterEventId(
	sessionId: string,
	book: number,
	chapter: number,
): string {
	return (
		sessionId.slice(0, 30) +
		(Number.parseInt(sessionId.slice(30), 16) ^ (book * 1000 + chapter))
			.toString(16)
			.padStart(6, "0")
	);
}
export function retryDelay(attempt: number, random: number): number {
	return Math.round(
		Math.min(300_000, 5_000 * 2 ** Math.min(attempt, 6)) * (0.8 + random * 0.4),
	);
}

export interface KeyValueStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
	getAllKeys(): Promise<readonly string[]>;
	/** Browser tabs share storage: acquire a cross-tab lock for local mutations. */
	exclusive?<T>(job: () => Promise<T>): Promise<T>;
}
interface StoredEntry {
	entry: ReadingEntry;
	syncedRevision: number;
	blocked?: boolean;
}
interface Session {
	id: string;
	lastActivity: number;
}
export interface JournalStatus {
	pending: number;
	blocked: number;
	error: string | null;
}
/** One bounded record per session/chapter. Only pending and current-session rows live on-device. */
export class ReadingJournal {
	private rows = new Map<string, StoredEntry>();
	private session: Session | null = null;
	private loaded = false;
	private tail: Promise<unknown> = Promise.resolve();
	private error: string | null = null;
	private lastTouchAttempt: number | null = null;
	constructor(
		private storage: KeyValueStorage,
		private account: string,
		private uuid: () => string,
		private notify: () => void = () => {},
	) {}
	private prefix() {
		return `sureword:reading:v1:${encodeURIComponent(this.account)}:`;
	}
	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.tail.then(() =>
			this.storage.exclusive
				? this.storage.exclusive(async () => {
						// A different tab may have changed a snapshot since our last read.
						this.loaded = false;
						this.rows.clear();
						this.session = null;
						await this.load();
						return fn();
					})
				: fn(),
		);
		this.tail = run.catch(() => {});
		return run;
	}
	private async load() {
		if (this.loaded) return;
		const prefix = this.prefix();
		const session = await this.storage.getItem(prefix + "session");
		if (session) this.session = JSON.parse(session);
		const keys = (await this.storage.getAllKeys()).filter((k) =>
			k.startsWith(prefix + "event:"),
		);
		// Bounded chunks avoid a large native bridge response for long offline periods.
		for (let i = 0; i < keys.length; i += 50)
			for (const [key, value] of await Promise.all(
				keys
					.slice(i, i + 50)
					.map(async (k) => [k, await this.storage.getItem(k)] as const),
			)) {
				if (value)
					this.rows.set(
						key.slice((prefix + "event:").length),
						JSON.parse(value),
					);
			}
		this.loaded = true;
		this.notify();
	}
	status(): JournalStatus {
		return {
			pending: [...this.rows.values()].filter(
				(r) => r.entry.revision > r.syncedRevision,
			).length,
			blocked: [...this.rows.values()].filter((r) => r.blocked).length,
			error: this.error,
		};
	}
	initialize() {
		return this.serial(() => this.load());
	}
	touch(now: number) {
		// Throttle before acquiring the browser lock: serial() refreshes shared
		// storage, which must not enumerate an offline backlog on every scroll.
		const knownActivity = this.session?.lastActivity;
		if (
			knownActivity !== undefined &&
			now >= knownActivity &&
			now - knownActivity < 10_000
		)
			return Promise.resolve();
		if (
			this.lastTouchAttempt !== null &&
			now >= this.lastTouchAttempt &&
			now - this.lastTouchAttempt < 10_000
		)
			return Promise.resolve();
		this.lastTouchAttempt = now;
		return this.serial(async () => {
			await this.load();
			if (
				!this.session ||
				now - this.session.lastActivity >= SESSION_IDLE_MS ||
				now - this.session.lastActivity < 10_000
			)
				return;
			const next = { ...this.session, lastActivity: now };
			await this.storage.setItem(
				this.prefix() + "session",
				JSON.stringify(next),
			);
			this.session = next;
		});
	}
	retryBlocked() {
		return this.serial(async () => {
			await this.load();
			for (const row of this.rows.values())
				if (row.blocked) await this.put({ ...row, blocked: false });
			this.error = null;
			this.notify();
		});
	}
	private async put(row: StoredEntry) {
		await this.storage.setItem(
			this.prefix() + "event:" + row.entry.eventId,
			JSON.stringify(row),
		);
		this.rows.set(row.entry.eventId, row);
	}
	record(input: {
		book: number;
		chapter: number;
		translation: string;
		verses: number[];
		verseCount: number;
		now: number;
		timezone: string;
	}): Promise<void> {
		return this.serial(async () => {
			await this.load();
			if (!input.verses.length) return;
			if (
				!this.session ||
				input.now - this.session.lastActivity >= SESSION_IDLE_MS ||
				input.now < this.session.lastActivity
			) {
				const next = { id: this.uuid(), lastActivity: input.now };
				await this.storage.setItem(
					this.prefix() + "session",
					JSON.stringify(next),
				);
				this.session = next;
				for (const [id, row] of this.rows)
					if (row.syncedRevision >= row.entry.revision) {
						await this.storage.removeItem(this.prefix() + "event:" + id);
						this.rows.delete(id);
					}
			}
			const eventId = chapterEventId(
				this.session.id,
				input.book,
				input.chapter,
			);
			const old = this.rows.get(eventId);
			const verses = compactVerses([
				...(old ? coveredVerses(old.entry.verseRanges) : []),
				...input.verses.filter((v) => v <= input.verseCount),
			]);
			if (JSON.stringify(verses) !== JSON.stringify(old?.entry.verseRanges)) {
				await this.put({
					syncedRevision: old?.syncedRevision ?? 0,
					entry: {
						eventId,
						sessionId: this.session.id,
						revision: (old?.entry.revision ?? 0) + 1,
						source: "reader",
						book: input.book,
						chapter: input.chapter,
						translation: input.translation,
						occurredAt:
							old?.entry.occurredAt ?? new Date(input.now).toISOString(),
						// Timestamp and timezone describe the same original observation.
						timezone: old?.entry.timezone ?? input.timezone,
						precision: "exact",
						completed:
							verses.length === 1 &&
							verses[0].start === 1 &&
							verses[0].end === input.verseCount,
						verseRanges: verses,
					},
				});
			}
			const nextSession = { ...this.session, lastActivity: input.now };
			await this.storage.setItem(
				this.prefix() + "session",
				JSON.stringify(nextSession),
			);
			this.session = nextSession;
			this.error = null;
			this.notify();
		}).catch((e) => {
			this.error =
				e instanceof Error && e.name === "ReadingStorageUnavailable"
					? e.message
					: "Reading could not be saved on this device. Free some storage and try again.";
			this.notify();
			throw e;
		});
	}
	/** Authentication is pinned by caller; recheck active account before each send and after each await. */
	async flush(
		send: (entry: ReadingEntry) => Promise<void>,
		active: () => boolean,
	): Promise<void> {
		await this.initialize();
		const pending = [...this.rows.values()]
			.filter((r) => r.entry.revision > r.syncedRevision && !r.blocked)
			.slice(0, 25);
		for (const row of pending) {
			if (!active()) return;
			try {
				await send(row.entry);
			} catch (e) {
				const status = (e as { status?: number }).status;
				if (status === 400 || status === 422 || status === 409) {
					await this.serial(async () => {
						const current = this.rows.get(row.entry.eventId);
						if (current?.entry.revision === row.entry.revision)
							await this.put({ ...current, blocked: true });
					});
					this.error =
						"A reading needs attention. Your entry is kept on this device.";
					this.notify();
					continue;
				}
				throw e;
			}
			await this.serial(async () => {
				const current = this.rows.get(row.entry.eventId);
				if (!current) return;
				const next = {
					...current,
					syncedRevision: Math.max(current.syncedRevision, row.entry.revision),
				};
				if (
					next.syncedRevision >= next.entry.revision &&
					next.entry.sessionId !== this.session?.id
				) {
					await this.storage.removeItem(
						this.prefix() + "event:" + next.entry.eventId,
					);
					this.rows.delete(next.entry.eventId);
				} else await this.put(next);
				this.notify();
			});
		}
	}
}

/** Dwell belongs to each visible verse, so slow scrolling preserves overlap. */
export class VerseDwellTracker {
	private starts = new Map<number, number>();
	private emitted = new Set<number>();
	update(verses: number[], now: number) {
		const visible = new Set(verses);
		for (const verse of this.starts.keys())
			if (!visible.has(verse)) this.starts.delete(verse);
		for (const verse of visible)
			if (!this.starts.has(verse) && !this.emitted.has(verse))
				this.starts.set(verse, now);
	}
	due(now: number): number[] {
		const due: number[] = [];
		for (const [verse, start] of this.starts)
			if (now - start >= VERSE_DWELL_MS) {
				due.push(verse);
				this.starts.delete(verse);
				this.emitted.add(verse);
			}
		return due;
	}
	nextDelay(now: number): number | null {
		if (!this.starts.size) return null;
		return Math.max(
			0,
			Math.min(...this.starts.values()) + VERSE_DWELL_MS - now,
		);
	}
	pause() {
		this.starts.clear();
	}
	reset() {
		this.pause();
		this.emitted.clear();
	}
}

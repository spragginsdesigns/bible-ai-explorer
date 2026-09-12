import type {
	LearnCard,
	LearnResult,
	LearnReviewAcknowledgement,
	LearnReviewOperation,
	LearnToday,
} from "./learn";
import { isLearnCardDueAfterDay, parseCard, parseReviewAcknowledgement, parseToday, preserveCardText } from "./learn";

const STATE_VERSION = 3;
const MAX_CACHED_CARDS = 6;
const MAX_OUTBOX_OPERATIONS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accountWork = new Map<string, Promise<unknown>>();

function serializeAccount<T>(key: string, work: () => Promise<T>): Promise<T> {
	const previous = accountWork.get(key) ?? Promise.resolve();
	const result = previous.then(work, work);
	const settled = result.catch(() => undefined);
	accountWork.set(key, settled);
	void settled.finally(() => {
		if (accountWork.get(key) === settled) accountWork.delete(key);
	});
	return result;
}

export type LearnConflictCode = "revision_conflict" | "operation_id_reused" | "missing";
export type LearnConnection = "initializing" | "idle" | "syncing" | "offline" | "error";

export interface LearnStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
}

export class LearnReviewFailure extends Error {
	readonly code?: LearnConflictCode;
	readonly currentCard: LearnCard | null;
	readonly offline: boolean;

	constructor(
		message: string,
		options: { code?: LearnConflictCode; currentCard?: LearnCard | null; offline?: boolean } = {},
	) {
		super(message);
		this.name = "LearnReviewFailure";
		this.code = options.code;
		this.currentCard = options.currentCard ?? null;
		this.offline = options.offline ?? false;
	}
}

interface StoredConflict {
	code: LearnConflictCode;
	currentCard: LearnCard | null;
}

interface StoredReview {
	cardId: string;
	payload: LearnReviewOperation;
	before: LearnCard;
	predicted: LearnCard;
	completesSessionCard: boolean;
	status: "pending" | "acknowledged" | "conflict";
	acknowledgement?: LearnReviewAcknowledgement;
	conflict?: StoredConflict;
}

interface PersistedLearnState {
	version: typeof STATE_VERSION;
	ownerId: string;
	hasSnapshot: boolean;
	practiceDay: string;
	practiceTimezone: string;
	cards: LearnCard[];
	practiceCardIds: string[];
	knownCount: number;
	queueCount: number;
	outbox: StoredReview[];
}

export interface LearnConflictView {
	cardId: string;
	reference: string;
	code: LearnConflictCode;
	operationCount: number;
}

export interface LearnSyncSnapshot {
	hydrated: boolean;
	today: LearnToday | null;
	downloadedCards: LearnCard[];
	pendingCount: number;
	conflicts: LearnConflictView[];
	connection: LearnConnection;
	message: string | null;
}

export interface LearnSyncDependencies {
	storage: LearnStorage;
	fetchToday(): Promise<LearnToday>;
	sendReview(cardId: string, payload: LearnReviewOperation): Promise<LearnReviewAcknowledgement>;
	createOperationId(): string;
	now(): Date;
	timezone(): string;
}

function storageKey(userId: string): string {
	return `sureword:learn:v3:${encodeURIComponent(userId)}`;
}

export function learnStorageKey(userId: string): string {
	return storageKey(userId);
}

function emptyState(userId: string): PersistedLearnState {
	return {
		version: STATE_VERSION,
		ownerId: userId,
		hasSnapshot: false,
		practiceDay: "",
		practiceTimezone: "",
		cards: [],
		practiceCardIds: [],
		knownCount: 0,
		queueCount: 0,
		outbox: [],
	};
}

function validTimezone(value: string): string {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
		return value;
	} catch {
		return "UTC";
	}
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(instant);
	const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");
	const wallClockAsUtc = Date.UTC(
		part("year"),
		part("month") - 1,
		part("day"),
		part("hour") % 24,
		part("minute"),
		part("second"),
	);
	return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localDayParts(instant: Date, timeZone: string): [number, number, number] {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");
	return [part("year"), part("month"), part("day")];
}

function localDayKey(instant: Date, timeZone: string): string {
	const [year, month, day] = localDayParts(instant, timeZone);
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfShiftedLocalDay(instant: Date, timeZone: string, days: number): string {
	const [year, month, day] = localDayParts(instant, timeZone);
	const naive = Date.UTC(year, month - 1, day + days);
	const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
	return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone)).toISOString();
}

export function predictLearnReview(
	card: LearnCard,
	result: LearnResult,
	reviewedAt: string,
	timezone: string,
): LearnCard {
	const instant = new Date(reviewedAt);
	const zone = validTimezone(timezone);
	let stage = card.stage;
	let intervalDays = card.intervalDays;
	let dueInDays = 0;
	if (result === "again") {
		stage = 1;
		intervalDays = 0;
	} else if (card.stage < 3) {
		stage = (card.stage + 1) as LearnCard["stage"];
	} else {
		intervalDays = Math.max(1, card.intervalDays * 2);
		dueInDays = intervalDays;
	}
	return {
		...card,
		revision: card.revision + 1,
		stage,
		intervalDays,
		dueAt: startOfShiftedLocalDay(instant, zone, dueInDays),
		knownAt: card.knownAt ?? (intervalDays >= 16 ? reviewedAt : null),
	};
}

function parsePayload(value: unknown): LearnReviewOperation {
	const payload = value as Partial<LearnReviewOperation> | null;
	if (!payload || (payload.result !== "again" && payload.result !== "good") ||
		typeof payload.operationId !== "string" || !UUID.test(payload.operationId) ||
		!Number.isInteger(payload.expectedRevision) || payload.expectedRevision! < 0 ||
		typeof payload.reviewedAt !== "string" || !Number.isFinite(Date.parse(payload.reviewedAt)) ||
		typeof payload.timezone !== "string" || validTimezone(payload.timezone) !== payload.timezone) {
		throw new Error("Invalid stored Learn review");
	}
	return Object.freeze(payload as LearnReviewOperation);
}

function parseStoredReview(value: unknown): StoredReview {
	const review = value as Partial<StoredReview> | null;
	if (!review || typeof review.cardId !== "string" || !review.cardId ||
		!(["pending", "acknowledged", "conflict"] as const).includes(review.status as StoredReview["status"]) ||
		typeof review.completesSessionCard !== "boolean") {
		throw new Error("Invalid stored Learn outbox");
	}
	const payload = parsePayload(review.payload);
	const before = parseCard(review.before);
	const predicted = parseCard(review.predicted);
	if (before.id !== review.cardId || predicted.id !== review.cardId ||
		payload.expectedRevision !== before.revision || predicted.revision !== before.revision + 1) {
		throw new Error("Invalid stored Learn revision chain");
	}
	const parsed: StoredReview = { ...review, cardId: review.cardId, payload, before, predicted } as StoredReview;
	if (review.status === "acknowledged") {
		parsed.acknowledgement = parseReviewAcknowledgement(review.acknowledgement, payload.operationId);
	} else if (review.status === "conflict") {
		const conflict = review.conflict;
		if (!conflict || !(["revision_conflict", "operation_id_reused", "missing"] as const).includes(conflict.code)) {
			throw new Error("Invalid stored Learn conflict");
		}
		parsed.conflict = {
			code: conflict.code,
			currentCard: conflict.currentCard === null ? null : parseCard(conflict.currentCard),
		};
	}
	return parsed;
}

function parsePersistedState(raw: string, userId: string): PersistedLearnState {
	const value = JSON.parse(raw) as Partial<PersistedLearnState> | null;
	if (!value || value.version !== STATE_VERSION || value.ownerId !== userId ||
		typeof value.hasSnapshot !== "boolean" ||
		typeof value.practiceDay !== "string" ||
		typeof value.practiceTimezone !== "string" ||
		!Array.isArray(value.cards) || value.cards.length > MAX_CACHED_CARDS ||
		!Array.isArray(value.practiceCardIds) || value.practiceCardIds.length > 3 ||
		!Number.isInteger(value.knownCount) || value.knownCount! < 0 ||
		!Number.isInteger(value.queueCount) || value.queueCount! < 0 ||
		!Array.isArray(value.outbox) || value.outbox.length > MAX_OUTBOX_OPERATIONS) {
		throw new Error("Invalid stored Learn state");
	}
	const cards = value.cards.map(parseCard);
	if (new Set(cards.map((card) => card.id)).size !== cards.length ||
		value.practiceCardIds.some((id) => typeof id !== "string" || !cards.some((card) => card.id === id)) ||
		new Set(value.practiceCardIds).size !== value.practiceCardIds.length) {
		throw new Error("Invalid stored Learn cards");
	}
	return {
		version: STATE_VERSION,
		ownerId: userId,
		hasSnapshot: value.hasSnapshot,
		practiceDay: value.practiceDay,
		practiceTimezone: value.practiceTimezone,
		cards,
		practiceCardIds: [...value.practiceCardIds],
		knownCount: value.knownCount!,
		queueCount: value.queueCount!,
		outbox: value.outbox.map(parseStoredReview),
	};
}

function projectedCards(state: PersistedLearnState): Map<string, LearnCard> {
	const cards = new Map(state.cards.map((card) => [card.id, card]));
	for (const review of state.outbox) {
		if (review.status === "acknowledged") {
			const current = review.acknowledgement!.currentCard;
			if (current) cards.set(review.cardId, preserveCardText(cards.get(review.cardId), current));
			else cards.delete(review.cardId);
		} else {
			cards.set(review.cardId, review.predicted);
		}
	}
	return cards;
}

function activePracticeIds(state: PersistedLearnState): string[] {
	const ids = [...state.practiceCardIds];
	const cards = projectedCards(state);
	for (const review of state.outbox) {
		if (!review.completesSessionCard) continue;
		const current = cards.get(review.cardId);
		const dueAfterPracticeDay = current
			? localDayKey(new Date(current.dueAt), state.practiceTimezone || "UTC") > state.practiceDay
			: true;
		if (!dueAfterPracticeDay) continue;
		const index = ids.indexOf(review.cardId);
		if (index >= 0) ids.splice(index, 1);
	}
	return ids;
}

function rollPracticeDay(
	state: PersistedLearnState,
	now: Date,
	timezone: string,
): PersistedLearnState {
	if (!state.hasSnapshot) return state;
	const zone = validTimezone(timezone);
	const day = localDayKey(now, zone);
	if (state.practiceDay === day && state.practiceTimezone === zone) return state;
	const conflictedCards = new Set(state.outbox
		.filter((review) => review.status === "conflict")
		.map((review) => review.cardId));
	const cachedOrder = new Map(state.cards.map((card, index) => [card.id, index]));
	const dueCards = [...projectedCards(state).values()]
		.filter((card) => !conflictedCards.has(card.id) && !isLearnCardDueAfterDay(card, now, timezone))
		.sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
			(cachedOrder.get(left.id) ?? MAX_CACHED_CARDS) - (cachedOrder.get(right.id) ?? MAX_CACHED_CARDS))
		.slice(0, 3);
	return {
		...state,
		practiceDay: day,
		practiceTimezone: zone,
		practiceCardIds: dueCards.map((card) => card.id),
	};
}

function snapshotFor(
	state: PersistedLearnState | null,
	connection: LearnConnection,
	message: string | null,
): LearnSyncSnapshot {
	if (!state) {
		return {
			hydrated: false,
			today: null,
			downloadedCards: [],
			pendingCount: 0,
			conflicts: [],
			connection,
			message,
		};
	}
	const cards = projectedCards(state);
	const todayCards = activePracticeIds(state).flatMap((id) => {
		const card = cards.get(id);
		return card ? [card] : [];
	});
	const conflictedCardIds = new Set(state.outbox
		.filter((review) => review.status === "conflict")
		.map((review) => review.cardId));
	const conflictCards = new Map<string, LearnConflictView>();
	for (const review of state.outbox) {
		if (!conflictedCardIds.has(review.cardId)) continue;
		const current = conflictCards.get(review.cardId);
		const conflict = review.status === "conflict"
			? review.conflict!
			: state.outbox.find((item) => item.cardId === review.cardId && item.status === "conflict")!.conflict!;
		conflictCards.set(review.cardId, {
			cardId: review.cardId,
			reference: review.before.reference,
			code: conflict.code,
			operationCount: (current?.operationCount ?? 0) + 1,
		});
	}
	return {
		hydrated: true,
		today: state.hasSnapshot ? {
			cards: todayCards,
			knownCount: state.knownCount,
			queueCount: state.queueCount,
		} : null,
		downloadedCards: [...cards.values()],
		pendingCount: state.outbox.length,
		conflicts: [...conflictCards.values()],
		connection,
		message,
	};
}

function isOfflineError(error: unknown): boolean {
	if (error instanceof LearnReviewFailure) return error.offline;
	if (error instanceof TypeError) return true;
	return Boolean(error && typeof error === "object" &&
		(("isNetworkError" in error && error.isNetworkError) || ("isTimeout" in error && error.isTimeout)));
}

export class LearnSyncStore {
	private state: PersistedLearnState | null = null;
	private connection: LearnConnection = "initializing";
	private message: string | null = null;
	private listeners = new Set<(snapshot: LearnSyncSnapshot) => void>();
	private chain: Promise<unknown> = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly userId: string,
		private readonly dependencies: LearnSyncDependencies,
	) {}

	getSnapshot(): LearnSyncSnapshot {
		return snapshotFor(this.state, this.connection, this.message);
	}

	subscribe(listener: (snapshot: LearnSyncSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.getSnapshot());
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
	}

	/** React Strict Mode restarts effects on the same memoized store. */
	activate(): void {
		this.disposed = false;
	}

	private publish(): void {
		if (this.disposed) return;
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) listener(snapshot);
	}

	private setConnection(connection: LearnConnection, message: string | null = null): void {
		this.connection = connection;
		this.message = message;
		this.publish();
	}

	private exclusive<T>(work: () => Promise<T>): Promise<T> {
		const key = storageKey(this.userId);
		const result = this.chain.then(
			() => serializeAccount(key, work),
			() => serializeAccount(key, work),
		);
		this.chain = result.catch(() => undefined);
		return result;
	}

	private async commit(next: PersistedLearnState): Promise<void> {
		if (this.disposed) return;
		await this.dependencies.storage.setItem(storageKey(this.userId), JSON.stringify(next));
		if (this.disposed) return;
		this.state = next;
		this.publish();
	}

	async hydrate(): Promise<void> {
		return this.exclusive(async () => {
			if (this.disposed) return;
			try {
				const raw = await this.dependencies.storage.getItem(storageKey(this.userId));
				let next = emptyState(this.userId);
				if (raw) {
					try { next = parsePersistedState(raw, this.userId); }
					catch { await this.dependencies.storage.setItem(storageKey(this.userId), JSON.stringify(next)); }
				}
				const rolled = rollPracticeDay(next, this.dependencies.now(), this.dependencies.timezone());
				if (rolled !== next) {
					await this.dependencies.storage.setItem(storageKey(this.userId), JSON.stringify(rolled));
					next = rolled;
				}
				if (!this.disposed) {
					this.state = next;
					this.setConnection("idle");
				}
			} catch {
				this.setConnection("error", "Learn could not read its saved practice data on this device.");
				throw new Error("Learn storage is unavailable");
			}
		});
	}

	async installToday(value: LearnToday): Promise<void> {
		return this.exclusive(async () => {
			if (this.disposed) return;
			await this.installTodayInside(parseToday(value));
		});
	}

	private async installTodayInside(today: LearnToday): Promise<void> {
		if (!this.state) throw new Error("Learn has not hydrated");
		await this.commit(this.mergeToday(this.state, today));
	}

	private mergeToday(state: PersistedLearnState, today: LearnToday): PersistedLearnState {
		const oldCards = new Map(state.cards.map((card) => [card.id, card]));
		const incoming = today.cards.map((card) => preserveCardText(oldCards.get(card.id), card));
		const keepIds = new Set([
			...state.outbox.map((review) => review.cardId),
			...state.practiceCardIds,
		]);
		const retained = state.cards.filter((card) =>
			!incoming.some((next) => next.id === card.id) &&
			(keepIds.has(card.id) || state.hasSnapshot));
		const cards = [...incoming, ...retained].slice(0, MAX_CACHED_CARDS);
		return {
			...state,
			hasSnapshot: true,
			practiceDay: localDayKey(this.dependencies.now(), validTimezone(this.dependencies.timezone())),
			practiceTimezone: validTimezone(this.dependencies.timezone()),
			cards,
			practiceCardIds: today.cards.map((card) => card.id),
			knownCount: today.knownCount,
			queueCount: today.queueCount,
		};
	}

	async enqueue(cardId: string, result: LearnResult): Promise<LearnReviewOperation> {
		return this.exclusive(async () => {
			if (this.disposed) throw new Error("Learn session is closed");
			if (!this.state) throw new Error("Learn has not hydrated");
			if (this.state.outbox.length >= MAX_OUTBOX_OPERATIONS) {
				throw new Error("Sync saved reviews before continuing.");
			}
			const before = projectedCards(this.state).get(cardId);
			if (!before || !activePracticeIds(this.state).includes(cardId)) {
				throw new Error("This verse is no longer in the current practice session.");
			}
			const reviewedAt = this.dependencies.now().toISOString();
			const timezone = validTimezone(this.dependencies.timezone());
			const operationId = this.dependencies.createOperationId();
			if (!UUID.test(operationId)) throw new Error("Could not create a safe review identifier.");
			const payload: LearnReviewOperation = Object.freeze({
				result,
				operationId,
				expectedRevision: before.revision,
				reviewedAt,
				timezone,
			});
			const predicted = predictLearnReview(before, result, reviewedAt, timezone);
			const review: StoredReview = {
				cardId,
				payload,
				before,
				predicted,
				completesSessionCard: result === "good" && before.stage === 3,
				status: "pending",
			};
			try {
				await this.commit({ ...this.state, outbox: [...this.state.outbox, review] });
				this.setConnection(this.connection === "initializing" ? "idle" : this.connection);
				return payload;
			} catch {
				this.setConnection("error", "This review was not saved on the device and was not sent.");
				throw new Error("Could not save this review on the device. Nothing was sent.");
			}
		});
	}

	async synchronize(options: { refresh?: boolean } = {}): Promise<void> {
		return this.exclusive(async () => {
			if (this.disposed) return;
			await this.synchronizeInside(options.refresh ?? true);
		});
	}

	private async synchronizeInside(refresh: boolean): Promise<void> {
		if (!this.state) throw new Error("Learn has not hydrated");
		if (this.disposed) return;
		this.setConnection("syncing");
		try {
			const rolled = rollPracticeDay(this.state, this.dependencies.now(), this.dependencies.timezone());
			if (rolled !== this.state) await this.commit(rolled);
			while (true) {
				if (this.disposed) return;
				const acknowledged = this.state.outbox.find((review) => review.status === "acknowledged");
				if (acknowledged) {
					await this.finalizeAcknowledgement(acknowledged);
					continue;
				}
				const blockedCards = new Set<string>();
				let candidate: StoredReview | undefined;
				for (const review of this.state.outbox) {
					if (review.status === "conflict") {
						blockedCards.add(review.cardId);
						continue;
					}
					if (review.status === "pending" && !blockedCards.has(review.cardId)) {
						candidate = review;
						break;
					}
				}
				if (!candidate) break;
				try {
					const acknowledgement = parseReviewAcknowledgement(
						await this.dependencies.sendReview(candidate.cardId, candidate.payload),
						candidate.payload.operationId,
					);
					if (this.disposed) return;
					if (acknowledgement.appliedRevision !== candidate.payload.expectedRevision + 1) {
						throw new Error("Learn returned an unexpected applied revision");
					}
					const nextOutbox = this.state.outbox.map((review) =>
						review.payload.operationId === candidate!.payload.operationId
							? { ...review, status: "acknowledged" as const, acknowledgement }
							: review);
					// The receipt reaches durable storage before this operation is removed or
					// a dependent operation can be sent.
					await this.commit({ ...this.state, outbox: nextOutbox });
				} catch (error) {
					if (error instanceof LearnReviewFailure && error.code) {
						const currentCard = error.currentCard
							? preserveCardText(projectedCards(this.state).get(candidate.cardId), error.currentCard)
							: null;
						const nextOutbox = this.state.outbox.map((review) =>
							review.payload.operationId === candidate!.payload.operationId
								? { ...review, status: "conflict" as const, conflict: { code: error.code!, currentCard } }
								: review);
						await this.commit({ ...this.state, outbox: nextOutbox });
						continue;
					}
					this.setConnection(isOfflineError(error) ? "offline" : "error",
						isOfflineError(error)
							? "Saved reviews are waiting on this device for a connection."
							: "Saved reviews could not sync. Try again.");
					return;
				}
			}

			if (this.state.outbox.some((review) => review.status === "conflict")) {
				this.setConnection("idle");
				return;
			}
			if (refresh) {
				const today = parseToday(await this.dependencies.fetchToday());
				if (this.disposed) return;
				await this.installTodayInside(today);
			}
			this.setConnection("idle");
		} catch (error) {
			this.setConnection(isOfflineError(error) ? "offline" : "error",
				isOfflineError(error)
					? "Connect once to download verses, or keep practicing the saved session."
					: "Learn could not refresh from the server. Try again.");
		}
	}

	private async finalizeAcknowledgement(review: StoredReview): Promise<void> {
		if (!this.state || !review.acknowledgement) return;
		const cards = new Map(this.state.cards.map((card) => [card.id, card]));
		const current = review.acknowledgement.currentCard;
		if (current) cards.set(review.cardId, preserveCardText(cards.get(review.cardId), current));
		else cards.delete(review.cardId);
		const practiceCardIds = !current || (current ? isLearnCardDueAfterDay(
				current,
				this.dependencies.now(),
				validTimezone(this.dependencies.timezone()),
			) : false)
			? this.state.practiceCardIds.filter((id) => id !== review.cardId)
			: this.state.practiceCardIds;
		const knownCount = this.state.knownCount +
			(!review.before.knownAt && current?.knownAt ? 1 : 0);
		let outbox = this.state.outbox.filter(
			(item) => item.payload.operationId !== review.payload.operationId);
		const dependentIndex = outbox.findIndex(
			(item) => item.cardId === review.cardId && item.status === "pending");
		const dependencyIsStale = !current || current.revision > review.acknowledgement.appliedRevision;
		if (dependentIndex >= 0 && dependencyIsStale) {
			outbox = outbox.map((item, index) => index === dependentIndex ? {
				...item,
				status: "conflict" as const,
				conflict: {
					code: current ? "revision_conflict" as const : "missing" as const,
					currentCard: current,
				},
			} : item);
		}
		await this.commit({
			...this.state,
			cards: [...cards.values()].slice(0, MAX_CACHED_CARDS),
			practiceCardIds,
			knownCount,
			outbox,
		});
	}

	async useLatestSchedule(cardId: string): Promise<void> {
		return this.exclusive(async () => {
			if (this.disposed) return;
			if (!this.state) throw new Error("Learn has not hydrated");
			const conflict = this.state.outbox.find(
				(review) => review.cardId === cardId && review.status === "conflict");
			if (!conflict) return;
			if (conflict.conflict!.code === "operation_id_reused") {
				this.setConnection("syncing");
				try {
					const today = parseToday(await this.dependencies.fetchToday());
					if (this.disposed) return;
					const withoutRejectedCard = {
						...this.state,
						cards: this.state.cards.filter((card) => card.id !== cardId),
						practiceCardIds: this.state.practiceCardIds.filter((id) => id !== cardId),
						outbox: this.state.outbox.filter((review) => review.cardId !== cardId),
					};
					await this.commit(this.mergeToday(withoutRejectedCard, today));
					this.setConnection("idle");
				} catch (error) {
					this.setConnection(isOfflineError(error) ? "offline" : "error",
						"The latest schedule could not be loaded. Your saved reviews were kept.");
				}
				return;
			}
			const cards = new Map(this.state.cards.map((card) => [card.id, card]));
			const current = conflict.conflict!.currentCard;
			if (conflict.conflict!.code === "revision_conflict") {
				if (current) cards.set(cardId, preserveCardText(cards.get(cardId), current));
				else cards.delete(cardId);
			}
			const outbox = this.state.outbox.filter((review) => review.cardId !== cardId);
			const removeFromPractice = !current || (current ? isLearnCardDueAfterDay(
				current,
				this.dependencies.now(),
				validTimezone(this.dependencies.timezone()),
			) : false);
			await this.commit({
				...this.state,
				cards: [...cards.values()].slice(0, MAX_CACHED_CARDS),
				practiceCardIds: removeFromPractice
					? this.state.practiceCardIds.filter((id) => id !== cardId)
					: this.state.practiceCardIds,
				outbox,
			});
			await this.synchronizeInside(true);
		});
	}
}

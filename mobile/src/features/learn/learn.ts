export type LearnStage = 0 | 1 | 2 | 3;
export type LearnResult = "again" | "good";

export interface LearnCard {
	id: string;
	revision: number;
	book: number;
	chapter: number;
	verse: number;
	translation: "KJV" | "NKJV";
	reference: string;
	text: string;
	textUnavailable?: true;
	stage: LearnStage;
	intervalDays: number;
	dueAt: string;
	knownAt: string | null;
}

export interface LearnToday {
	cards: LearnCard[];
	knownCount: number;
	queueCount: number;
}

export interface LearnReviewOperation {
	result: LearnResult;
	operationId: string;
	expectedRevision: number;
	reviewedAt: string;
	timezone: string;
}

export interface LearnReviewAcknowledgement {
	operationId: string;
	appliedRevision: number;
	replayed: boolean;
	currentCard: LearnCard | null;
}

export interface VerseWord {
	text: string;
	hidden: boolean;
	blank: string;
}

/** Whitespace defines a word; punctuation surrounding a blank remains visible. */
export function verseWords(text: string, stage: LearnStage): VerseWord[] {
	return text.trim().split(/\s+/).filter(Boolean).map((word, index) => {
		const prefix = word.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
		const suffix = word.slice(prefix.length).match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
		return {
			text: word,
			hidden: stage === 3 || (stage === 1 && index % 4 === 3) || (stage === 2 && index % 2 === 1),
			blank: `${prefix}____${suffix}`,
		};
	});
}

export function maskVerse(text: string, stage: LearnStage): string {
	return verseWords(text, stage).map((word) => word.hidden ? word.blank : word.text).join(" ");
}

function isIsoInstant(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseCard(value: unknown): LearnCard {
	const card = value as Partial<LearnCard> | null;
	const textUnavailable = card?.textUnavailable;
	if (!card || typeof card.id !== "string" || !card.id ||
		!Number.isInteger(card.revision) || card.revision! < 0 ||
		!Number.isInteger(card.book) || card.book! < 1 || card.book! > 66 ||
		!Number.isInteger(card.chapter) || card.chapter! < 1 ||
		!Number.isInteger(card.verse) || card.verse! < 1 ||
		!["KJV", "NKJV"].includes(card.translation!) ||
		typeof card.reference !== "string" || !card.reference.trim() ||
		typeof card.text !== "string" ||
		!(textUnavailable === undefined || textUnavailable === true) ||
		(!card.text.trim() && textUnavailable !== true) ||
		![0, 1, 2, 3].includes(card.stage!) ||
		!Number.isInteger(card.intervalDays) || card.intervalDays! < 0 ||
		!isIsoInstant(card.dueAt) ||
		!(card.knownAt === null || isIsoInstant(card.knownAt))) {
		throw new Error("Learn returned an invalid verse. Please reload.");
	}
	return card as LearnCard;
}

export function parseToday(value: unknown): LearnToday {
	const today = value as Partial<LearnToday> | null;
	if (!today || !Array.isArray(today.cards) || today.cards.length > 3 ||
		!Number.isInteger(today.knownCount) || today.knownCount! < 0 ||
		!Number.isInteger(today.queueCount) || today.queueCount! < 0) {
		throw new Error("Learn returned an invalid queue. Please reload.");
	}
	const cards = today.cards.map(parseCard);
	if (new Set(cards.map((card) => card.id)).size !== cards.length) {
		throw new Error("Learn returned duplicate verses.");
	}
	return { cards, knownCount: today.knownCount!, queueCount: today.queueCount! };
}

export function parseReviewAcknowledgement(
	value: unknown,
	expectedOperationId?: string,
): LearnReviewAcknowledgement {
	const acknowledgement = value as Partial<LearnReviewAcknowledgement> | null;
	if (!acknowledgement || typeof acknowledgement.operationId !== "string" ||
		(expectedOperationId !== undefined && acknowledgement.operationId !== expectedOperationId) ||
		!Number.isInteger(acknowledgement.appliedRevision) || acknowledgement.appliedRevision! < 1 ||
		typeof acknowledgement.replayed !== "boolean" ||
		!("currentCard" in acknowledgement)) {
		throw new Error("Learn returned an invalid review receipt. Please reload.");
	}
	const currentCard = acknowledgement.currentCard === null ? null : parseCard(acknowledgement.currentCard);
	if (currentCard && currentCard.revision < acknowledgement.appliedRevision!) {
		throw new Error("Learn returned an invalid review receipt. Please reload.");
	}
	return {
		operationId: acknowledgement.operationId,
		appliedRevision: acknowledgement.appliedRevision!,
		replayed: acknowledgement.replayed,
		currentCard,
	};
}

/** Keep valid cached text when a receipt cannot resolve that same translation. */
export function preserveCardText(previous: LearnCard | undefined, current: LearnCard): LearnCard {
	if (!current.textUnavailable || current.text.trim() || !previous?.text.trim() ||
		previous.translation !== current.translation) return current;
	return { ...current, text: previous.text, textUnavailable: undefined };
}

function dayKey(instant: Date, timezone: string): string {
	let safeTimezone = timezone;
	try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
	catch { safeTimezone = "UTC"; }
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: safeTimezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isLearnCardDueAfterDay(card: LearnCard, instant: Date, timezone: string): boolean {
	return dayKey(new Date(card.dueAt), timezone) > dayKey(instant, timezone);
}

/** Keep same-day ladder stages on screen; a completed stage-3 review leaves today. */
export function applyReviewAcknowledgement(
	today: LearnToday,
	before: LearnCard,
	operation: LearnReviewOperation,
	acknowledgement: LearnReviewAcknowledgement,
	receivedAt: Date = new Date(),
	timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): LearnToday {
	if (acknowledgement.operationId !== operation.operationId) {
		throw new Error("The review returned a different receipt. Please reload.");
	}
	if (acknowledgement.appliedRevision !== operation.expectedRevision + 1) {
		throw new Error("The review returned an unexpected revision. Please reload.");
	}
	const current = acknowledgement.currentCard
		? preserveCardText(before, acknowledgement.currentCard)
		: null;
	if (current && current.id !== before.id) {
		throw new Error("The review returned a different verse. Please reload.");
	}
	const deferred = current ? isLearnCardDueAfterDay(current, receivedAt, timezone) : false;
	return {
		...today,
		knownCount: today.knownCount + (!before.knownAt && current?.knownAt ? 1 : 0),
		cards: deferred || !current
			? today.cards.filter((card) => card.id !== before.id)
			: today.cards.map((card) => card.id === before.id ? current : card),
	};
}

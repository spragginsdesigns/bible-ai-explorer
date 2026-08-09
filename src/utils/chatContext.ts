export interface ConversationHistoryMessage {
	role: "user" | "assistant";
	content: string;
}

export const MAX_HISTORY_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_CHARACTERS = 12_000;
export const MAX_HISTORY_CHARACTERS = 100_000;
const MAX_HISTORY_INPUT_MESSAGES = MAX_HISTORY_MESSAGES + 1;
const MAX_RETRIEVAL_CONTEXT_CHARACTERS = 6000;
const MAX_WEB_SUBJECT_CHARACTERS = 500;

const ELLIPTICAL_REFERENCE_PATTERN =
	/^(?:what|how) about (?:(?:the )?(?:(?:next|previous|preceding|following|same|other|last) )?(?:verse|verses|chapter|passage|reference)(?:\s+\d+(?::\d+(?:-\d+)?)?)?|(?:this|that|it|these|those))[?.!]*$/i;

const ELABORATION_REQUEST_PATTERN =
	/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:explain|clarify|elaborate|expand|unpack)(?:\s+(?:on\s+)?(?:this|that|it))?(?:\s+(?:again|further|more|in (?:more|greater) detail))?[?.!]*$/i;

const DIRECT_FOLLOW_UP_PATTERNS = [
	/^(?:why|how|when|where|who)\??$/i,
	/^(?:how so|in what way|why (?:is|was) that|what makes you say that)[?.!]*$/i,
	/^(?:what do you mean|tell me more|say more|go deeper|keep going|continue)(?:\s+(?:on|about) (?:this|that|it))?[?.!]*$/i,
	/^(?:show|give) me (?:another|one more) (?:verse|passage)(?:\s+.+)?[?.!]*$/i,
];

const CONTEXT_REFERENCE_PATTERN =
	/\b(?:this|that|it|these|those|they|them|he|she|his|her|another|same|above|previous|earlier)\b/i;

const DISCOURSE_REFERENCE_PATTERN =
	/\b(?:what (?:(?:you|i)(?:'ve|'d)?|did (?:you|i)) (?:just |previously |earlier )?(?:say|said|ask|asked|mean|meant|mention|mentioned|explain|explained|describe|described|show|showed|suggest|suggested)|(?:the )?(?:first|second|third|fourth|last|next|previous|earlier|above) (?:point|reason|example|connection|verse|passage|part|section)(?: in (?:your|the) (?:answer|response|explanation))?|(?:point|connection|distinction|comparison|claim|example) you (?:just |previously |earlier )?(?:made|drew|gave|mentioned|explained|described)|(?:your|the) (?:previous|earlier|last|above) (?:answer|response|explanation))\b/i;

const CLEAR_STANDALONE_PATTERN =
	/^(?:what does it mean to\b|(?:is|was) it (?:a|an|wrong|right|sin|sinful|biblical|possible|okay|ok)\b)|\b(?:about|regarding|concerning)\s+(?!this\b|that\b|it\b|these\b|those\b|the (?:same|previous|earlier|above)\b).+/i;

export class ChatHistoryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChatHistoryValidationError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeForComparison(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isContextDependentQuestion(question: string): boolean {
	const normalized = question.trim().replace(/\s+/g, " ");
	if (!normalized) return false;

	if (
		ELLIPTICAL_REFERENCE_PATTERN.test(normalized) ||
		ELABORATION_REQUEST_PATTERN.test(normalized)
	) {
		return true;
	}

	if (DIRECT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized))) {
		return true;
	}

	if (DISCOURSE_REFERENCE_PATTERN.test(normalized)) {
		return true;
	}

	if (CLEAR_STANDALONE_PATTERN.test(normalized)) {
		return false;
	}

	const wordCount = normalized.split(/\s+/).length;
	return wordCount <= 10 && CONTEXT_REFERENCE_PATTERN.test(normalized);
}

export function buildConversationRequestHistory(
	messages: readonly ConversationHistoryMessage[],
	currentQuestion: string
): ConversationHistoryMessage[] {
	const sanitizedMessages = messages.flatMap((message): ConversationHistoryMessage[] => {
		const content = message.content.trim().slice(0, MAX_CHAT_MESSAGE_CHARACTERS);
		return content ? [{ role: message.role, content }] : [];
	});
	const question = currentQuestion.trim().slice(0, MAX_CHAT_MESSAGE_CHARACTERS);
	const lastMessage = sanitizedMessages.at(-1);
	const previousMessages =
		question &&
		lastMessage?.role === "user" &&
		normalizeForComparison(lastMessage.content) === normalizeForComparison(question)
			? sanitizedMessages.slice(0, -1)
			: sanitizedMessages;

	const recentMessages: ConversationHistoryMessage[] = [];
	let totalCharacters = 0;

	for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
		if (recentMessages.length >= MAX_HISTORY_MESSAGES) break;

		const message = previousMessages[index];
		if (totalCharacters + message.content.length > MAX_HISTORY_CHARACTERS) break;

		recentMessages.push(message);
		totalCharacters += message.content.length;
	}

	recentMessages.reverse();
	if (question) recentMessages.push({ role: "user", content: question });

	return recentMessages;
}

export function parseConversationHistory(
	value: unknown,
	currentQuestion: string
): ConversationHistoryMessage[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		throw new ChatHistoryValidationError("Invalid input: 'history' must be an array.");
	}
	if (value.length > MAX_HISTORY_INPUT_MESSAGES) {
		throw new ChatHistoryValidationError(
			`Invalid input: 'history' cannot contain more than ${MAX_HISTORY_INPUT_MESSAGES} messages.`
		);
	}

	const messages = value.map((item, index): ConversationHistoryMessage => {
		if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant")) {
			throw new ChatHistoryValidationError(
				`Invalid input: history message ${index + 1} has an invalid role or shape.`
			);
		}
		if (typeof item.content !== "string" || !item.content.trim()) {
			throw new ChatHistoryValidationError(
				`Invalid input: history message ${index + 1} must have non-empty string content.`
			);
		}

		const content = item.content.trim();
		if (content.length > MAX_CHAT_MESSAGE_CHARACTERS) {
			throw new ChatHistoryValidationError(
				`Invalid input: each history message is limited to ${MAX_CHAT_MESSAGE_CHARACTERS} characters.`
			);
		}

		return { role: item.role, content };
	});

	const lastMessage = messages.at(-1);
	if (
		lastMessage?.role === "user" &&
		normalizeForComparison(lastMessage.content) === normalizeForComparison(currentQuestion)
	) {
		messages.pop();
	}

	if (messages.length > MAX_HISTORY_MESSAGES) {
		throw new ChatHistoryValidationError(
			`Invalid input: history is limited to ${MAX_HISTORY_MESSAGES} recent messages.`
		);
	}

	const totalCharacters = messages.reduce(
		(total, message) => total + message.content.length,
		0
	);
	if (totalCharacters > MAX_HISTORY_CHARACTERS) {
		throw new ChatHistoryValidationError(
			`Invalid input: recent history is limited to ${MAX_HISTORY_CHARACTERS} total characters.`
		);
	}

	return messages;
}

export function buildContextualRetrievalQuery(
	question: string,
	history: ConversationHistoryMessage[]
): string {
	if (!history.length || !isContextDependentQuestion(question)) {
		return question;
	}

	let remainingCharacters = MAX_RETRIEVAL_CONTEXT_CHARACTERS - question.length;
	const recentContext: string[] = [];

	for (const message of [...history].reverse()) {
		if (remainingCharacters <= 0) break;
		const label = message.role === "user" ? "User" : "VerseMind";
		const content = message.content.slice(-remainingCharacters);
		recentContext.push(`${label}: ${content}`);
		remainingCharacters -= content.length;
	}

	return [
		"Bible study conversation context:",
		...recentContext.reverse(),
		`Current follow-up: ${question}`,
	].join("\n");
}

export function buildContextualWebSearchQuery(
	question: string,
	history: ConversationHistoryMessage[]
): string {
	if (!history.length || !isContextDependentQuestion(question)) {
		return question;
	}

	const userMessages = history.filter((message) => message.role === "user");
	const subject =
		[...userMessages].reverse().find((message) => !isContextDependentQuestion(message.content)) ??
		userMessages.at(-1);

	if (!subject) return question;

	return `Bible study topic: ${subject.content.slice(0, MAX_WEB_SUBJECT_CHARACTERS)}\nFollow-up: ${question}`;
}

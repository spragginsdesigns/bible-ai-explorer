/**
 * Shared chat error contract between the server and every client.
 *
 * - Pre-stream failures come back as JSON: `{ error: string, code: ChatErrorCode }`.
 * - Mid-stream failures arrive as an SSE error chunk whose text is
 *   `[code] message`; clients strip the prefix and classify on the code.
 * - Classification order: (a) JSON body `code`, (b) `[code]` prefix,
 *   (c) HTTP status, (d) network/timeout detection, then a generic fallback.
 *
 * This module is dependency-free so both the web client and the server
 * (`src/lib/ai/errors.ts`) can import the enum without pulling in React.
 */
export const CHAT_ERROR_CODES = [
	"unauthorized",
	"invalid_input",
	"conversation_not_found",
	"provider_key_missing",
	"provider_error",
	"rate_limited",
	"internal",
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
	return typeof value === "string" && (CHAT_ERROR_CODES as readonly string[]).includes(value);
}

export interface ClassifiedChatError {
	code: ChatErrorCode;
	title: string;
	message: string;
	retryable: boolean;
}

export interface ClassifyChatErrorInput {
	status?: number;
	/** Raw response body text, when the caller has it (fetch path). */
	bodyText?: string;
	/**
	 * Error message text. The AI SDK transport throws pre-stream HTTP failures
	 * with the raw body as the message, so this is also probed for the JSON
	 * shape and the `[code]` prefix.
	 */
	message?: string;
	isNetworkError?: boolean;
	isTimeout?: boolean;
}

// Chrome throws TypeError("Failed to fetch") on a dead connection; Firefox
// says "NetworkError when attempting to fetch resource.", Safari "Load failed".
// Anchored so the SDK's "Failed to fetch the chat response." fallback for an
// empty error body is NOT mistaken for a dead connection.
const NETWORK_PATTERN = /^(failed to fetch\.?|load failed\.?)$/i;
const NETWORK_SUBSTRING = /network ?error|network request failed/i;
const TIMEOUT_PATTERN = /timed? ?out|timeout/i;
const CODE_PREFIX_PATTERN = /^\[([a-z_]+)\]\s*/;

/** Strip a mid-stream "[code] " prefix, per the shared contract. */
export function extractCodePrefix(text: string): { code: ChatErrorCode | null; message: string } {
	const match = CODE_PREFIX_PATTERN.exec(text);
	if (match && isChatErrorCode(match[1])) {
		return { code: match[1], message: text.slice(match[0].length) };
	}
	return { code: null, message: text };
}

/** Parse a server JSON error body ({ error, code }) if the text looks like one. */
function parseJsonErrorBody(text: string): { code: ChatErrorCode | null; message: string | null } {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return { code: null, message: null };
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed !== "object" || parsed === null) return { code: null, message: null };
		const record = parsed as Record<string, unknown>;
		return {
			code: isChatErrorCode(record.code) ? record.code : null,
			message: typeof record.error === "string" ? record.error : null,
		};
	} catch {
		return { code: null, message: null };
	}
}

function copyFor(code: ChatErrorCode, serverMessage: string | null): ClassifiedChatError {
	switch (code) {
		case "unauthorized":
			return {
				code,
				title: "Sign in again",
				message: serverMessage ?? "Your session has expired. Sign in again to keep chatting.",
				retryable: false,
			};
		case "invalid_input":
			return {
				code,
				title: "Couldn't send that",
				message: serverMessage ?? "That message couldn't be sent. Adjust it and try again.",
				retryable: false,
			};
		case "conversation_not_found":
			return {
				code,
				title: "Conversation not found",
				message: serverMessage ?? "This conversation is no longer available. Start a new chat.",
				retryable: false,
			};
		case "provider_key_missing":
			return {
				code,
				title: "API key needed",
				message:
					serverMessage ??
					"Add your provider API key in Settings → AI Providers to use this model.",
				retryable: false,
			};
		case "provider_error":
			return {
				code,
				title: "Provider error",
				message:
					serverMessage ??
					"The AI provider could not complete this request. Try again, or pick a different model from the model picker.",
				retryable: true,
			};
		case "rate_limited":
			return {
				code,
				title: "Slow down a moment",
				message:
					serverMessage ??
					"You're sending messages faster than we can keep up. Try again in a moment.",
				retryable: true,
			};
		case "internal":
			return {
				code,
				title: "Something went wrong",
				message: serverMessage ?? "Something went wrong on our end. Please try again.",
				retryable: true,
			};
	}
}

/** Recovery polled past the server's own budget and the answer never landed. */
export function recoveryExhaustedError(): ClassifiedChatError {
	return {
		code: "internal",
		title: "Couldn't retrieve that answer",
		message: "The answer finished but we couldn't load it. Ask again to retry.",
		retryable: true,
	};
}

/** Conversation creation failed before the send could even start. */
export function conversationStartError(): ClassifiedChatError {
	return {
		code: "internal",
		title: "Couldn't start the conversation",
		message: "Check your connection and try again.",
		retryable: true,
	};
}

export function classifyChatError(input: ClassifyChatErrorInput): ClassifiedChatError {
	// (a) An explicit body, or the raw-body-as-message the AI SDK transport
	// throws for pre-stream HTTP failures.
	const candidates = [input.bodyText, input.message].filter(
		(text): text is string => typeof text === "string" && text.length > 0
	);
	for (const candidate of candidates) {
		const body = parseJsonErrorBody(candidate);
		if (body.code) return copyFor(body.code, body.message);
	}

	// (b) A mid-stream "[code] message" error chunk.
	const message = input.message ?? "";
	if (message) {
		const prefixed = extractCodePrefix(message);
		if (prefixed.code) return copyFor(prefixed.code, prefixed.message);
	}

	// (c) HTTP status, when the caller has one.
	if (input.status) {
		if (input.status === 401 || input.status === 403) return copyFor("unauthorized", null);
		if (input.status === 400 || input.status === 422) {
			return copyFor("invalid_input", message || null);
		}
		if (input.status === 404) return copyFor("conversation_not_found", null);
		if (input.status === 429) return copyFor("rate_limited", null);
	}

	// (d) Network and timeout detection.
	if (input.isTimeout || TIMEOUT_PATTERN.test(message)) {
		return {
			code: "internal",
			title: "Request timed out",
			message: "The request took too long. Check your connection and try again.",
			retryable: true,
		};
	}
	if (input.isNetworkError || NETWORK_PATTERN.test(message) || NETWORK_SUBSTRING.test(message)) {
		return {
			code: "internal",
			title: "You're offline",
			message: "We couldn't reach the server. Check your internet connection and try again.",
			retryable: true,
		};
	}

	return copyFor("internal", null);
}

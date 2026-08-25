/**
 * Pure half of chat error handling, kept free of React and native imports so
 * it can be unit-tested (api.ts is imported for ApiError only). The hook in
 * useSureWordChat.ts owns the state; this module turns whatever the transport
 * or REST layer threw into copy the UI can show.
 *
 * The server speaks a shared error contract (see /api/ask-question):
 * pre-stream failures are JSON `{ error, code }`, mid-stream SSE error chunks
 * serialize as `[code] message`. Older servers send neither, so classification
 * falls back to the HTTP status, then to network/timeout detection, then to a
 * generic internal error.
 */

import { ApiError } from "@/lib/api";

/**
 * The server's fixed code enum, plus two client-side codes for failures that
 * never reached the server (offline/timeout).
 */
export type ChatErrorCode =
	| "unauthorized"
	| "invalid_input"
	| "conversation_not_found"
	| "provider_key_missing"
	| "provider_error"
	| "rate_limited"
	| "offline"
	| "timeout"
	| "internal";

export interface ClassifiedChatError {
	code: ChatErrorCode;
	title: string;
	message: string;
	retryable: boolean;
}

const SERVER_CODES: readonly ChatErrorCode[] = [
	"unauthorized",
	"invalid_input",
	"conversation_not_found",
	"provider_key_missing",
	"provider_error",
	"rate_limited",
	"internal",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const COPY: Record<ChatErrorCode, { title: string; message: string; retryable: boolean }> = {
	offline: {
		title: "You're offline",
		message: "You appear to be offline. Reconnect and try again.",
		retryable: true,
	},
	timeout: {
		title: "The request timed out",
		message: "The request timed out. Check your connection and try again.",
		retryable: true,
	},
	unauthorized: {
		title: "Sign in again",
		message: "Your session could not be verified. Sign in again to keep chatting.",
		retryable: false,
	},
	invalid_input: {
		title: "That message could not be sent",
		message: "The server could not use that message. Edit it and try again.",
		retryable: false,
	},
	conversation_not_found: {
		title: "Conversation not found",
		message: "This conversation is no longer available. Start a new chat to continue.",
		retryable: false,
	},
	provider_key_missing: {
		title: "The AI provider is not configured",
		message: "The AI provider is not set up right now. Try again later.",
		retryable: false,
	},
	provider_error: {
		title: "The AI provider had a problem",
		message: "The AI provider could not answer. Try again.",
		retryable: true,
	},
	rate_limited: {
		title: "Too many requests",
		message: "You've reached the request limit. Try again in a moment.",
		retryable: true,
	},
	internal: {
		title: "Something went wrong",
		message: "Something went wrong while answering. Try again.",
		retryable: true,
	},
};

/**
 * Strip a mid-stream `[code] message` prefix. Unknown bracket tags are left
 * alone - they are more likely message text than a server code.
 */
export function parseErrorCodePrefix(text: string): { code: ChatErrorCode; rest: string } | null {
	const match = /^\[([a-z_]+)\]\s*(.*)$/s.exec(text.trim());
	if (!match) return null;
	const code = match[1] as ChatErrorCode;
	if (!SERVER_CODES.includes(code)) return null;
	return { code, rest: match[2] };
}

/**
 * Parse a pre-stream `{ "error": "...", "code": "..." }` body. The AI SDK
 * transport throws non-OK responses with the raw body text as the error
 * message, so this is what keeps literal JSON off the screen.
 */
function parseJsonErrorBody(text: string): { code?: ChatErrorCode; message?: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		const data: unknown = JSON.parse(trimmed);
		if (!isRecord(data)) return null;
		const code =
			typeof data.code === "string" && SERVER_CODES.includes(data.code as ChatErrorCode)
				? (data.code as ChatErrorCode)
				: undefined;
		const message = typeof data.error === "string" ? data.error : undefined;
		if (!code && !message) return null;
		return { code, message };
	} catch {
		return null;
	}
}

/** A message worth showing verbatim: short, human, not serialized data. */
function looksFriendly(text: string | undefined): text is string {
	if (!text) return false;
	const trimmed = text.trim();
	if (trimmed.length === 0 || trimmed.length > 300) return false;
	if (trimmed.startsWith("{") || trimmed.startsWith("<")) return false;
	// apiJson's own fallback when the server sent no message at all.
	if (/^Request failed: \d+$/.test(trimmed)) return false;
	return true;
}

function build(
	code: ChatErrorCode,
	serverMessage: string | undefined,
	overrideMessage?: string
): ClassifiedChatError {
	const copy = COPY[code];
	return {
		code,
		title: copy.title,
		message: overrideMessage ?? (looksFriendly(serverMessage) ? serverMessage.trim() : copy.message),
		retryable: copy.retryable,
	};
}

/**
 * Classify anything the chat pipeline can throw - an ApiError from the REST
 * layer, the AI SDK transport's Error carrying a raw response body, a
 * mid-stream `[code]` chunk, or a bare string from an old server. Order
 * follows the shared contract: JSON body code, `[code]` prefix, HTTP status,
 * network/timeout detection, then a generic internal fallback.
 */
export function classifyChatError(error: unknown, opts?: { message?: string }): ClassifiedChatError {
	const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";

	// (a) A parsed JSON body with a contract code wins over everything else.
	const json = parseJsonErrorBody(raw);
	if (json?.code) return build(json.code, json.message, opts?.message);

	// (b) Mid-stream SSE error chunk: `[code] message`.
	const prefixed = parseErrorCodePrefix(json?.message ?? raw);
	if (prefixed) return build(prefixed.code, prefixed.rest, opts?.message);

	// (c) HTTP status, for old servers that send no code at all.
	if (error instanceof ApiError && error.status !== undefined) {
		const status = error.status;
		if (status === 400) return build("invalid_input", json?.message ?? raw, opts?.message);
		if (status === 401) return build("unauthorized", json?.message ?? raw, opts?.message);
		if (status === 404) return build("conversation_not_found", json?.message ?? raw, opts?.message);
		if (status === 429) return build("rate_limited", json?.message ?? raw, opts?.message);
		return build("internal", json?.message ?? raw, opts?.message);
	}

	// (d) Network/timeout detection - these never carry a status.
	if (error instanceof ApiError && error.isTimeout) return build("timeout", undefined, opts?.message);
	if (error instanceof ApiError && error.isNetworkError) return build("offline", undefined, opts?.message);
	// React Native / undici network failures surface as TypeError("Network request failed").
	if (error instanceof TypeError || /network request failed|failed to fetch/i.test(raw)) {
		return build("offline", undefined, opts?.message);
	}

	// Fallback: keep an old server's bare message if it is human-readable.
	return build("internal", json?.message ?? raw, opts?.message);
}

/**
 * The recovery poll outlasted the server's own answer budget and the answer
 * still has not landed. Keeps the existing copy - retrying the question is
 * the honest option at that point.
 */
export function recoveryExhaustedError(): ClassifiedChatError {
	return {
		code: "internal",
		title: "The answer did not arrive",
		message: "We couldn't retrieve that answer. Retry to ask again.",
		retryable: true,
	};
}

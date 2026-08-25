import { APICallError } from "ai";
import { AiCredentialError } from "./provider";
import type { ChatErrorCode } from "@/lib/chat/chatErrors";

/**
 * A failure whose message was written for the user to read. Everything else
 * that escapes a stream is an internal fault and must be reported generically,
 * because the response headers are already sent by then and the text goes
 * straight into the chat.
 */
export class UserFacingError extends Error {
	constructor(
		message: string,
		public readonly code: ChatErrorCode = "invalid_input"
	) {
		super(message);
		this.name = "UserFacingError";
	}
}

export function codeForError(error: unknown): ChatErrorCode {
	if (error instanceof UserFacingError) return error.code;
	if (error instanceof AiCredentialError) return "provider_key_missing";
	if (APICallError.isInstance(error)) return "provider_error";
	return "internal";
}

/** Body for every pre-stream JSON error response: { error, code }. */
export function chatErrorPayload(
	code: ChatErrorCode,
	message: string
): { error: string; code: ChatErrorCode } {
	return { error: message, code };
}

const PROVIDER_STREAM_MESSAGE =
	"The AI provider could not complete this request. Try again, or pick a different model from the model picker.";
const INTERNAL_STREAM_MESSAGE = "An error occurred.";

/**
 * Mid-stream SSE error text: "[code] message", per the shared client contract.
 * Clients strip the prefix and classify on the code. A provider rejection is
 * the user's to act on (wrong model for the job, an expired key, a rate
 * limit) - "An error occurred" sends them nowhere.
 */
export function streamErrorText(error: unknown): string {
	const code = codeForError(error);
	if (error instanceof UserFacingError || error instanceof AiCredentialError) {
		return `[${code}] ${error.message}`;
	}
	if (code === "provider_error") return `[${code}] ${PROVIDER_STREAM_MESSAGE}`;
	return `[internal] ${INTERNAL_STREAM_MESSAGE}`;
}

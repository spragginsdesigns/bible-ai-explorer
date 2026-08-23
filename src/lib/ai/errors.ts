/**
 * A failure whose message was written for the user to read. Everything else
 * that escapes a stream is an internal fault and must be reported generically,
 * because the response headers are already sent by then and the text goes
 * straight into the chat.
 */
export class UserFacingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserFacingError";
	}
}

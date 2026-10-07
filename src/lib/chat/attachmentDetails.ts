import type { ChatAttachmentDescriptor } from "@/lib/chat-attachment-types";

/**
 * What an attachment carries beyond the file part a UI message can hold: a
 * voice message's transcript and length. Chat messages are rebuilt from file
 * parts (filename, type, url), which have no room for these, so they are kept
 * here by attachment id, filled from upload completion and from history loads,
 * and merged back in when a message renders. Never sent to the model: the
 * server reads its own stored transcript.
 */
type AttachmentDetails = Pick<ChatAttachmentDescriptor, "transcript" | "durationSeconds">;

const detailsById = new Map<string, AttachmentDetails>();

export function rememberAttachmentDetails(attachment: {
	id?: unknown;
	transcript?: unknown;
	durationSeconds?: unknown;
}): void {
	if (typeof attachment.id !== "string") return;
	const details: AttachmentDetails = {};
	if (typeof attachment.transcript === "string") details.transcript = attachment.transcript;
	if (typeof attachment.durationSeconds === "number") details.durationSeconds = attachment.durationSeconds;
	if (details.transcript !== undefined || details.durationSeconds !== undefined) {
		detailsById.set(attachment.id, details);
	}
}

export function withAttachmentDetails(attachment: ChatAttachmentDescriptor): ChatAttachmentDescriptor {
	const details = detailsById.get(attachment.id);
	return details ? { ...attachment, ...details } : attachment;
}

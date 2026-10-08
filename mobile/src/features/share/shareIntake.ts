/**
 * "Share into SureWord": what to do with the text and files another app hands
 * over. Pure, so the decisions are pinned by tests; the native intake lives in
 * ShareIntentBridge and the chat screen applies the result.
 *
 * A share opens a new chat with the files attached and the text in the
 * composer, plus one-tap actions: check it against Scripture (/check) or
 * help answer whoever sent it (/reply), and, when the share carries a link,
 * verify the video or page itself (/verify).
 */
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_MESSAGE_BYTES,
	attachmentSizeError,
	filenameForSharedFile,
	resolveAttachmentType,
} from "@/features/chat/attachmentRules";
import { findYouTubeLink } from "@/features/chat/videoTranscript";

/** The parts of expo-share-intent's ShareIntent this reads. */
export interface IncomingShare {
	text?: string | null;
	webUrl?: string | null;
	files?: readonly IncomingSharedFile[] | null;
}

export interface IncomingSharedFile {
	path: string | null;
	mimeType: string | null;
	fileName: string | null;
	size: number | null;
}

export interface SharedFile {
	uri: string;
	filename: string;
	mediaType: string;
	/** Unknown until the file is read, when the sharing app did not say. */
	size: number | null;
}

export interface SharedChatDraft {
	/** Goes in the composer as-is, for the user to edit or send. */
	text: string;
	files: SharedFile[];
	/** Why something that was shared is not attached, shown above the composer. */
	notices: string[];
}

export type ShareAction = "verify" | "check" | "reply";

export interface ShareActionOption {
	action: ShareAction;
	label: string;
	command: string;
}

export const SHARE_ACTIONS: readonly ShareActionOption[] = [
	{ action: "verify", label: "Verify this link", command: "/verify" },
	{ action: "check", label: "Check against Scripture", command: "/check" },
	{ action: "reply", label: "Help me reply", command: "/reply" },
];

/**
 * The actions a share offers. A shared link (the YouTube app's Share button
 * sends just the URL) leads with Verify, worded for a video when it is one;
 * without a link there is nothing to verify, so it is left out.
 */
export function shareActionsFor(composerText: string): ShareActionOption[] {
	const rest = SHARE_ACTIONS.filter((entry) => entry.action !== "verify");
	const video = findYouTubeLink(composerText);
	if (!video && !/https?:\/\/\S+/i.test(composerText)) return rest;
	const label = video ? "Verify this video" : "Verify this link";
	return [{ action: "verify", label, command: "/verify" }, ...rest];
}

export function planSharedChat(share: IncomingShare): SharedChatDraft {
	const text = (share.text ?? "").trim() || (share.webUrl ?? "").trim();
	const notices: string[] = [];
	const accepted: SharedFile[] = [];

	(share.files ?? []).forEach((file, index) => {
		if (!file.path) return;
		const filename = filenameForSharedFile(file.fileName, file.mimeType, `shared-${index + 1}`);
		const resolved = resolveAttachmentType(filename, file.mimeType);
		if (!resolved.ok) {
			notices.push(resolved.message);
			return;
		}
		const size = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : null;
		const sizeError = size === null ? null : attachmentSizeError(filename, resolved.mediaType, size);
		if (sizeError) {
			notices.push(sizeError);
			return;
		}
		accepted.push({ uri: file.path, filename, mediaType: resolved.mediaType, size });
	});

	const files = accepted.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
	if (accepted.length > files.length) {
		notices.push(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message, so only the first ${MAX_ATTACHMENTS_PER_MESSAGE} were attached.`);
	}

	// Sizes the sharing app reported; an unreported one is checked after it is read.
	let total = 0;
	const fitting = files.filter((file) => {
		const next = total + (file.size ?? 0);
		if (next > MAX_ATTACHMENT_MESSAGE_BYTES) {
			notices.push(`Attachments can total up to 25 MB per message, so ${file.filename} was left out.`);
			return false;
		}
		total = next;
		return true;
	});

	if (!text && fitting.length === 0 && notices.length === 0) {
		notices.push("Nothing in that share could be opened in SureWord.");
	}
	return { text, files: fitting, notices };
}

/** The message a share action sends: the command, then whatever is in the composer. */
export function shareActionMessage(action: ShareAction, composerText: string): string {
	const command = SHARE_ACTIONS.find((entry) => entry.action === action)?.command ?? "/check";
	const text = composerText.trim();
	return text ? `${command} ${text}` : command;
}

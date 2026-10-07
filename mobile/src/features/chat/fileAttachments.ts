import { File, Paths } from "expo-file-system";
import { apiJson, type GetToken } from "@/lib/api";
import {
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_MESSAGE_BYTES,
	attachmentSizeError,
	isAudioMediaType,
	resolveAttachmentType,
} from "./attachmentRules";

export { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_MESSAGE_BYTES };

/**
 * A voice message is transcribed before /complete answers, which the server
 * allows two minutes for; the default 30 s request timeout would abandon it.
 */
const AUDIO_COMPLETE_TIMEOUT_MS = 125_000;

export interface ChatAttachmentDescriptor {
	id: string;
	filename: string;
	mediaType: string;
	size: number;
	previewUrl: string;
	previewExpiresAt: string;
	/** Audio only: what was said, transcribed once when the upload completed. */
	transcript?: string;
	/** Audio only: length in seconds. */
	durationSeconds?: number;
}

export interface LocalChatAttachment {
	uri: string;
	filename: string;
	mediaType: string;
	size: number;
}

export function normalizeLocalAttachment(input: Omit<LocalChatAttachment, "size"> & { size?: number | null }): LocalChatAttachment {
	const resolved = resolveAttachmentType(input.filename, input.mediaType);
	if (!resolved.ok) throw new Error(resolved.message);
	const size = input.size ?? new File(input.uri).size;
	const sizeError = attachmentSizeError(input.filename, resolved.mediaType, size);
	if (sizeError) throw new Error(sizeError);
	return { ...input, size, mediaType: resolved.mediaType };
}

/**
 * A file shared from another app arrives as a content:// URI whose read grant
 * belongs to the share and can lapse before the upload runs. Copy it into the
 * app's own cache at once and upload the copy. Anything else is returned as is.
 */
export async function copySharedFileToCache(uri: string, filename: string): Promise<string> {
	if (!uri.startsWith("content://")) return uri;
	const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "shared";
	const target = new File(Paths.cache, `shared-${Date.now()}-${safeName}`);
	await new File(uri).copy(target);
	return target.uri;
}

export function validateLocalAttachmentBatch(
	files: LocalChatAttachment[],
	existing: ChatAttachmentDescriptor[],
): void {
	if (files.length + existing.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new Error("You can attach up to 5 files per message.");
	}
	const total = files.reduce((sum, file) => sum + file.size, 0)
		+ existing.reduce((sum, file) => sum + file.size, 0);
	if (total > MAX_ATTACHMENT_MESSAGE_BYTES) {
		throw new Error("Attachments can total up to 25 MB per message.");
	}
}

export async function uploadChatAttachments(
	getToken: GetToken,
	files: LocalChatAttachment[],
): Promise<ChatAttachmentDescriptor[]> {
	const initialized = await apiJson<{
		uploads: Array<{ id: string; uploadUrl: string; mediaType: string }>;
	}>(getToken, "/api/chat/attachments", {
		method: "POST",
		body: {
			files: files.map((file) => ({
				filename: file.filename,
				mediaType: file.mediaType,
				size: file.size,
			})),
		},
	});

	try {
		return await Promise.all(initialized.uploads.map(async (upload, index) => {
			const result = await new File(files[index].uri).upload(upload.uploadUrl, {
				httpMethod: "PUT",
				headers: { "Content-Type": upload.mediaType },
				mimeType: upload.mediaType,
				sessionType: "foreground",
			});
			if (result.status < 200 || result.status >= 300) {
				throw new Error(`Could not upload ${files[index].filename}.`);
			}
			const completed = await apiJson<{ attachment: ChatAttachmentDescriptor }>(
				getToken,
				`/api/chat/attachments/${upload.id}/complete`,
				{ method: "POST" },
				isAudioMediaType(upload.mediaType) ? { timeoutMs: AUDIO_COMPLETE_TIMEOUT_MS } : undefined,
			);
			return completed.attachment;
		}));
	} catch (error) {
		await Promise.allSettled(initialized.uploads.map((upload) =>
			apiJson(getToken, `/api/chat/attachments/${upload.id}`, { method: "DELETE" }),
		));
		throw error;
	}
}

export async function deleteChatAttachment(getToken: GetToken, id: string): Promise<void> {
	await apiJson(getToken, `/api/chat/attachments/${id}`, { method: "DELETE" });
}

export async function refreshChatAttachment(
	getToken: GetToken,
	id: string,
): Promise<ChatAttachmentDescriptor | null> {
	const result = await apiJson<{ attachments: ChatAttachmentDescriptor[] }>(
		getToken,
		"/api/chat/attachments/refresh",
		{ method: "POST", body: { ids: [id] } },
	);
	return result.attachments[0] ?? null;
}

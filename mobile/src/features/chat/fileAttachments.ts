import { File, Paths } from "expo-file-system";
import { apiJson, type GetToken } from "@/lib/api";
import { copySharedFileBounded, type SharedFileCopy } from "@/lib/sharedFileCopy";
import { sharedFileCopyLimit, sharedFileSizeError, type SharedFile } from "@/features/share/shareIntake";
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
 * belongs to the share and can lapse before the upload runs, so it is copied
 * into the app's own cache at once and the copy is uploaded. The sending app
 * picks both the size it declares and the bytes it serves, so the copy stops
 * at the first byte past the cap (the type's, or what the message has left
 * after `usedBytes`), and the size checked and uploaded is the one measured.
 */
export async function copySharedFileToCache(file: SharedFile, usedBytes: number): Promise<LocalChatAttachment> {
	const declaredError = file.size === null ? null : sharedFileSizeError(file, file.size, usedBytes);
	if (declaredError) throw new Error(declaredError);

	if (!file.uri.startsWith("content://")) {
		const size = new File(file.uri).size;
		const sizeError = sharedFileSizeError(file, size, usedBytes);
		if (sizeError) throw new Error(sizeError);
		return normalizeLocalAttachment({ ...file, size });
	}

	const limit = sharedFileCopyLimit(file.mediaType, usedBytes);
	const copied = await copySharedFileBounded(file.uri, limit) ?? await copyWholeSharedFile(file);
	if (copied.tooLarge) {
		throw new Error(sharedFileSizeError(file, copied.size, usedBytes) ?? `${file.filename} is too large to attach.`);
	}
	const target = new File(copied.uri);
	try {
		const sizeError = sharedFileSizeError(file, copied.size, usedBytes);
		if (sizeError) throw new Error(sizeError);
		return normalizeLocalAttachment({ ...file, uri: copied.uri, size: copied.size });
	} catch (error) {
		if (target.exists) target.delete();
		throw error;
	}
}

/**
 * The unbounded copy, for a JS update running on a binary built before the
 * SureWordShare module: its oversize result is deleted by the caller.
 */
async function copyWholeSharedFile(file: SharedFile): Promise<SharedFileCopy> {
	const safeName = file.filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "shared";
	const target = new File(Paths.cache, `shared-${Date.now()}-${safeName}`);
	try {
		await new File(file.uri).copy(target);
	} catch (error) {
		if (target.exists) target.delete();
		throw error;
	}
	return { tooLarge: false, uri: target.uri, size: target.size };
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

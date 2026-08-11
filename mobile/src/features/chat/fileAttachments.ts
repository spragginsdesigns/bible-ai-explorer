import { File } from "expo-file-system";
import { apiJson, type GetToken } from "@/lib/api";

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

export interface ChatAttachmentDescriptor {
	id: string;
	filename: string;
	mediaType: string;
	size: number;
	previewUrl: string;
	previewExpiresAt: string;
}

export interface LocalChatAttachment {
	uri: string;
	filename: string;
	mediaType: string;
	size: number;
}

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	pdf: "application/pdf",
	txt: "text/plain",
	md: "text/markdown",
	markdown: "text/markdown",
	csv: "text/csv",
	json: "application/json",
};

export function normalizeLocalAttachment(input: Omit<LocalChatAttachment, "size"> & { size?: number }): LocalChatAttachment {
	const extension = input.filename.split(".").pop()?.toLowerCase() ?? "";
	const extensionType = MEDIA_TYPE_BY_EXTENSION[extension];
	const declaredType = input.mediaType.toLowerCase().split(";", 1)[0].trim();
	const mediaType = declaredType && declaredType !== "application/octet-stream"
		? declaredType
		: extensionType;
	if (!extensionType || mediaType !== extensionType) {
		throw new Error(`${input.filename} is not a supported PNG, JPEG, WebP, GIF, PDF, TXT, Markdown, CSV, or JSON file.`);
	}
	const size = input.size ?? new File(input.uri).size;
	if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${input.filename} is empty or unreadable.`);
	const limit = mediaType.startsWith("text/") || mediaType === "application/json"
		? MAX_TEXT_BYTES
		: MAX_IMAGE_OR_PDF_BYTES;
	if (size > limit) {
		throw new Error(`${input.filename} exceeds the ${limit === MAX_TEXT_BYTES ? "1 MB" : "10 MB"} file limit.`);
	}
	return { ...input, size, mediaType };
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

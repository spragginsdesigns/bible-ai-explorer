/**
 * The attachment allowlist and caps, without any native imports, so the share
 * intake and the vitest suite can use them. Mirrors src/lib/chat-attachment-types.ts
 * and src/lib/audio-transcription-rules.ts on the server, which stay the
 * authority: these checks only save a doomed upload.
 */

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
/** Under OpenAI's 25 MB transcription ceiling, with room for the request. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export const AUDIO_MEDIA_TYPES = [
	"audio/ogg",
	"audio/mpeg",
	"audio/mp4",
	"audio/wav",
	"audio/webm",
] as const;

/** What the document picker offers: every accepted type, audio included. */
export const PICKER_MEDIA_TYPES = [
	"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
	"text/plain", "text/markdown", "text/csv", "application/json",
	"audio/*",
];

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
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/ogg",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	webm: "audio/webm",
};

/**
 * Other names platforms give the same audio formats. Android reports m4a as
 * audio/x-m4a and a Discord voice message can arrive as audio/opus. Each is
 * read as its canonical type, which is what the server locks the upload to.
 */
const MEDIA_TYPE_ALIASES: Record<string, string> = {
	"audio/opus": "audio/ogg",
	"audio/x-opus+ogg": "audio/ogg",
	"application/ogg": "audio/ogg",
	"audio/mp3": "audio/mpeg",
	"audio/x-m4a": "audio/mp4",
	"audio/m4a": "audio/mp4",
	"audio/aac-mp4": "audio/mp4",
	"audio/x-wav": "audio/wav",
	"audio/wave": "audio/wav",
	"audio/vnd.wave": "audio/wav",
};

/** The extension a nameless file gets from its type, e.g. a share with no display name. */
const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"application/pdf": "pdf",
	"text/plain": "txt",
	"text/markdown": "md",
	"text/csv": "csv",
	"application/json": "json",
	"audio/ogg": "ogg",
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
	"audio/wav": "wav",
	"audio/webm": "webm",
};

export const UNSUPPORTED_FILE_HINT =
	"is not a supported image (PNG, JPEG, WebP, GIF), PDF, text (TXT, Markdown, CSV, JSON), or audio (OGG, MP3, M4A, WAV, WebM) file.";

export function isAudioMediaType(mediaType: string): boolean {
	return (AUDIO_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/** A declared type in canonical form: lowercased, parameters dropped, aliases resolved. */
export function canonicalMediaType(declared: string | null | undefined): string {
	const raw = (declared ?? "").toLowerCase().split(";", 1)[0].trim();
	return MEDIA_TYPE_ALIASES[raw] ?? raw;
}

export function mediaTypeFromFilename(filename: string): string | undefined {
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return undefined;
	return MEDIA_TYPE_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()];
}

/** The per-file byte cap for a type: text 1 MB, audio 20 MB, images and PDFs 10 MB. */
export function maxBytesFor(mediaType: string): number {
	if (mediaType.startsWith("text/") || mediaType === "application/json") return MAX_TEXT_BYTES;
	if (isAudioMediaType(mediaType)) return MAX_AUDIO_BYTES;
	return MAX_IMAGE_OR_PDF_BYTES;
}

/**
 * The type the server will accept this file as, or an error message. The
 * extension and the declared type must agree, because the server checks both;
 * an unknown or generic declared type falls back to the extension.
 */
export function resolveAttachmentType(
	filename: string,
	declaredType: string | null | undefined,
): { ok: true; mediaType: string } | { ok: false; message: string } {
	const extensionType = mediaTypeFromFilename(filename);
	const declared = canonicalMediaType(declaredType);
	const mediaType = declared && declared !== "application/octet-stream" ? declared : extensionType;
	if (!extensionType || mediaType !== extensionType) {
		return { ok: false, message: `${filename} ${UNSUPPORTED_FILE_HINT}` };
	}
	return { ok: true, mediaType };
}

/** null when the size fits, else the message to show. */
export function attachmentSizeError(filename: string, mediaType: string, size: number): string | null {
	if (!Number.isSafeInteger(size) || size <= 0) return `${filename} is empty or unreadable.`;
	const limit = maxBytesFor(mediaType);
	if (size > limit) return `${filename} exceeds the ${limit / (1024 * 1024)} MB file limit.`;
	return null;
}

/**
 * Give a shared file a name the server can check. Apps hand over names like
 * "voice-message" or "PTT-20261007" with no extension; the type supplies one.
 */
export function filenameForSharedFile(
	fileName: string | null | undefined,
	declaredType: string | null | undefined,
	fallbackStem: string,
): string {
	const name = (fileName ?? "").trim().split(/[\\/]/).pop() || fallbackStem;
	if (mediaTypeFromFilename(name)) return name;
	const extension = EXTENSION_BY_MEDIA_TYPE[canonicalMediaType(declaredType)];
	return extension ? `${name}.${extension}` : name;
}

/** "5:33" for 332.5 seconds, as the server and web format it. */
export function formatAudioDuration(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The chip's second line for a voice message. */
export function voiceMessageLabel(durationSeconds: number | undefined): string {
	return durationSeconds != null
		? `Voice message · ${formatAudioDuration(durationSeconds)}`
		: "Voice message";
}

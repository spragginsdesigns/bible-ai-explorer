export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
/** Under OpenAI's 25 MB transcription ceiling, with room for the request. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/**
 * The longest single voice message transcribed. Opus packs an hour into a few
 * megabytes, so the byte cap alone would not bound the cost.
 */
export const MAX_AUDIO_SECONDS = 15 * 60;

export const AUDIO_MEDIA_TYPES = [
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
] as const;

export const ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  ...AUDIO_MEDIA_TYPES,
] as const;

export type AttachmentMediaType = (typeof ATTACHMENT_MEDIA_TYPES)[number];
export type AudioMediaType = (typeof AUDIO_MEDIA_TYPES)[number];

/**
 * Other names platforms give the same audio formats. Android reports m4a as
 * audio/x-m4a, browsers say audio/x-wav or audio/mp3, and a Discord voice
 * message can arrive as audio/opus. Each is read as its canonical type, which is
 * what the upload URL is locked to.
 */
const MEDIA_TYPE_ALIASES: Record<string, AttachmentMediaType> = {
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

export function isAudioMediaType(value: string): value is AudioMediaType {
  return (AUDIO_MEDIA_TYPES as readonly string[]).includes(value);
}

export interface AttachmentInput {
  filename: string;
  mediaType: string;
  size: number;
}

export interface ValidatedAttachmentInput {
  filename: string;
  mediaType: AttachmentMediaType;
  size: number;
}

export interface ChatAttachmentDescriptor {
  id: string;
  filename: string;
  mediaType: AttachmentMediaType;
  size: number;
  previewUrl: string;
  previewExpiresAt: string;
  /** Audio only: what was said, transcribed once when the upload completed. */
  transcript?: string;
  /** Audio only: length in seconds. */
  durationSeconds?: number;
}

/** The trusted source of a user message that follows Daily Cross. */
export interface DailyCrossMessageOrigin {
	surface: "daily-cross";
	verseOfDayId: string;
	reference: string;
	action: "go-deeper";
}

/** Shape validation only; the server separately verifies ownership/reference. */
export function isDailyCrossMessageOrigin(value: unknown): value is DailyCrossMessageOrigin {
	if (typeof value !== "object" || value === null) return false;
	const origin = value as Record<string, unknown>;
	return (
		origin.surface === "daily-cross" &&
		typeof origin.verseOfDayId === "string" &&
		origin.verseOfDayId.trim().length > 0 &&
		typeof origin.reference === "string" &&
		origin.reference.trim().length > 0 &&
		origin.action === "go-deeper"
	);
}

/** Return only the four allowed fields so extra client metadata is never persisted. */
export function sanitizeDailyCrossMessageOrigin(value: unknown): DailyCrossMessageOrigin | null {
	if (!isDailyCrossMessageOrigin(value)) return null;
	return {
		surface: "daily-cross",
		verseOfDayId: value.verseOfDayId.trim(),
		reference: value.reference.trim(),
		action: "go-deeper",
	};
}

export interface SureWordMessageMetadata {
	attachmentIds?: string[];
	origin?: DailyCrossMessageOrigin;
	[key: string]: unknown;
}

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

const EXTENSIONS_BY_MEDIA_TYPE: Record<AttachmentMediaType, Set<string>> = {
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/webp": new Set(["webp"]),
  "image/gif": new Set(["gif"]),
  "application/pdf": new Set(["pdf"]),
  "text/plain": new Set(["txt"]),
  "text/markdown": new Set(["md", "markdown"]),
  "text/csv": new Set(["csv"]),
  "application/json": new Set(["json"]),
  "audio/ogg": new Set(["ogg", "oga", "opus"]),
  "audio/mpeg": new Set(["mp3"]),
  "audio/mp4": new Set(["m4a"]),
  "audio/wav": new Set(["wav"]),
  "audio/webm": new Set(["webm"]),
};

const MEDIA_TYPE_BY_EXTENSION = new Map<string, AttachmentMediaType>(
  Object.entries(EXTENSIONS_BY_MEDIA_TYPE).flatMap(([mediaType, extensions]) =>
    [...extensions].map((extension) => [extension, mediaType as AttachmentMediaType]),
  ),
);

const ALLOWED_MEDIA_TYPE_SET = new Set<string>(ATTACHMENT_MEDIA_TYPES);

export function isAttachmentMediaType(value: string): value is AttachmentMediaType {
  return ALLOWED_MEDIA_TYPE_SET.has(value.toLowerCase());
}

export function mediaTypeFromFilename(filename: string): AttachmentMediaType | undefined {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension ? MEDIA_TYPE_BY_EXTENSION.get(extension) : undefined;
}

export function validateAttachmentInput(input: AttachmentInput): ValidatedAttachmentInput {
  const filename = input.filename.trim();
  if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f]/.test(filename)) {
    throw new AttachmentValidationError("Each file needs a valid name of 255 characters or fewer.");
  }

  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new AttachmentValidationError(`${filename} is empty or has an invalid size.`);
  }

  const extensionMediaType = mediaTypeFromFilename(filename);
  const declaredRaw = input.mediaType.toLowerCase().split(";", 1)[0].trim();
  const declaredMediaType = MEDIA_TYPE_ALIASES[declaredRaw] ?? declaredRaw;
  const mediaType = isAttachmentMediaType(declaredMediaType)
    ? declaredMediaType
    : declaredMediaType === "" || declaredMediaType === "application/octet-stream"
      ? extensionMediaType
      : undefined;

  if (!mediaType || !extensionMediaType || mediaType !== extensionMediaType) {
    throw new AttachmentValidationError(
      `${filename} is not a supported image (PNG, JPEG, WebP, GIF), PDF, text (TXT, Markdown, CSV, JSON), or audio (OGG, MP3, M4A, WAV, WebM) file.`,
    );
  }

  const limit = maxBytesFor(mediaType);
  if (input.size > limit) {
    throw new AttachmentValidationError(`${filename} exceeds the ${limit / (1024 * 1024)} MB file limit.`);
  }

  return { filename, mediaType, size: input.size };
}

/**
 * Whether a stored blob's reported size fits the request. A reported size of 0
 * or none means "not stated", not "empty": Blob serves larger text compressed
 * with no length, so its metadata reads 0 for a 160 KB .txt. The caller always
 * compares the bytes it actually read as well.
 */
export function sizeMatches(reported: number | null | undefined, expected: number): boolean {
  return !reported || reported === expected;
}

/** The per-file byte cap for a type: text 1 MB, audio 20 MB, images and PDFs 10 MB. */
export function maxBytesFor(mediaType: AttachmentMediaType): number {
  if (mediaType.startsWith("text/") || mediaType === "application/json") return MAX_TEXT_ATTACHMENT_BYTES;
  if (isAudioMediaType(mediaType)) return MAX_AUDIO_BYTES;
  return MAX_IMAGE_OR_PDF_BYTES;
}

export function validateAttachmentBatch(inputs: AttachmentInput[]): ValidatedAttachmentInput[] {
  if (inputs.length === 0) {
    throw new AttachmentValidationError("Choose at least one file to upload.");
  }
  if (inputs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentValidationError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
  }

  const validated = inputs.map(validateAttachmentInput);
  const totalBytes = validated.reduce((total, input) => total + input.size, 0);
  if (totalBytes > MAX_ATTACHMENT_MESSAGE_BYTES) {
    throw new AttachmentValidationError("Attachments can total up to 25 MB per message.");
  }
  return validated;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const normalized = filename.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 120) || "attachment";
}

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_OR_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;

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
] as const;

export type AttachmentMediaType = (typeof ATTACHMENT_MEDIA_TYPES)[number];

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
}

export interface SureWordMessageMetadata {
  attachmentIds?: string[];
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
  const declaredMediaType = input.mediaType.toLowerCase().split(";", 1)[0].trim();
  const mediaType = isAttachmentMediaType(declaredMediaType)
    ? declaredMediaType
    : declaredMediaType === "" || declaredMediaType === "application/octet-stream"
      ? extensionMediaType
      : undefined;

  if (!mediaType || !extensionMediaType || mediaType !== extensionMediaType) {
    throw new AttachmentValidationError(
      `${filename} is not a supported PNG, JPEG, WebP, GIF, PDF, TXT, Markdown, CSV, or JSON file.`,
    );
  }

  const limit = mediaType.startsWith("text/") || mediaType === "application/json"
    ? MAX_TEXT_ATTACHMENT_BYTES
    : MAX_IMAGE_OR_PDF_BYTES;
  if (input.size > limit) {
    const limitLabel = limit === MAX_TEXT_ATTACHMENT_BYTES ? "1 MB" : "10 MB";
    throw new AttachmentValidationError(`${filename} exceeds the ${limitLabel} file limit.`);
  }

  return { filename, mediaType, size: input.size };
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

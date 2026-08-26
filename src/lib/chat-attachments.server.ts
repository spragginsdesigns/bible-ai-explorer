import "server-only";

import { del, get, issueSignedToken, presignUrl } from "@vercel/blob";
import type { ChatAttachment } from "@prisma/client";
import {
  type AttachmentMediaType,
  type ChatAttachmentDescriptor,
  MAX_IMAGE_OR_PDF_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
} from "@/lib/chat-attachment-types";

const UPLOAD_URL_LIFETIME_MS = 15 * 60 * 1000;
const PREVIEW_URL_LIFETIME_MS = 15 * 60 * 1000;

export class UploadedAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadedAttachmentValidationError";
  }
}

export async function createAttachmentUploadUrl(
  pathname: string,
  mediaType: AttachmentMediaType,
  size: number,
): Promise<{ uploadUrl: string; uploadExpiresAt: string }> {
  const validUntil = Date.now() + UPLOAD_URL_LIFETIME_MS;
  const token = await issueSignedToken({
    pathname,
    operations: ["put"],
    validUntil,
    allowedContentTypes: [mediaType],
    maximumSizeInBytes: size,
  });
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation: "put",
    pathname,
    validUntil,
    allowedContentTypes: [mediaType],
    maximumSizeInBytes: size,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { uploadUrl: presignedUrl, uploadExpiresAt: new Date(validUntil).toISOString() };
}

/**
 * A signed GET URL for a private blob.
 *
 * `expiresInSeconds` overrides the 15-minute default for callers whose blob is
 * *consumed* rather than glanced at: the spoken devotional is a several-minute
 * MP3 someone may pause and come back to, and a URL that expires under them
 * mid-listen is a broken feature, not a security posture.
 */
export async function createAttachmentPreviewUrl(
  pathname: string,
  expiresInSeconds?: number,
): Promise<{ previewUrl: string; previewExpiresAt: string }> {
  const lifetimeMs =
    expiresInSeconds !== undefined ? expiresInSeconds * 1000 : PREVIEW_URL_LIFETIME_MS;
  const validUntil = Date.now() + lifetimeMs;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    access: "private",
    operation: "get",
    pathname,
    validUntil,
  });
  return { previewUrl: presignedUrl, previewExpiresAt: new Date(validUntil).toISOString() };
}

export async function toAttachmentDescriptor(
  attachment: Pick<ChatAttachment, "id" | "filename" | "mediaType" | "size" | "pathname">,
): Promise<ChatAttachmentDescriptor> {
  const preview = await createAttachmentPreviewUrl(attachment.pathname);
  return {
    id: attachment.id,
    filename: attachment.filename,
    mediaType: attachment.mediaType as AttachmentMediaType,
    size: attachment.size,
    ...preview,
  };
}

export async function deleteAttachmentBlob(pathname: string, etag?: string | null): Promise<void> {
  await del(pathname, etag ? { ifMatch: etag } : undefined);
}

export async function deleteAttachmentBlobs(pathnames: string[]): Promise<void> {
  if (pathnames.length > 0) await del(pathnames);
}

async function readStream(stream: ReadableStream<Uint8Array>, maximumBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new UploadedAttachmentValidationError("The uploaded file exceeds its size limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, index) => bytes[index] === byte);
}

function asciiIncludes(bytes: Uint8Array, marker: string): boolean {
  return new TextDecoder("latin1").decode(bytes).includes(marker);
}

function validateFileSignature(bytes: Uint8Array, mediaType: AttachmentMediaType): void {
  const invalid = () => {
    throw new UploadedAttachmentValidationError("The uploaded file content does not match its file type.");
  };

  switch (mediaType) {
    case "image/png":
      if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) invalid();
      break;
    case "image/jpeg":
      if (!startsWith(bytes, [0xff, 0xd8, 0xff])) invalid();
      break;
    case "image/webp":
      if (!(asciiIncludes(bytes.slice(0, 12), "RIFF") && asciiIncludes(bytes.slice(0, 12), "WEBP"))) invalid();
      if (asciiIncludes(bytes, "ANIM")) throw new UploadedAttachmentValidationError("Animated WebP files are not supported.");
      break;
    case "image/gif":
      if (!(asciiIncludes(bytes.slice(0, 6), "GIF87a") || asciiIncludes(bytes.slice(0, 6), "GIF89a"))) invalid();
      if (asciiIncludes(bytes, "NETSCAPE2.0") || asciiIncludes(bytes, "ANIMEXTS1.0")) {
        throw new UploadedAttachmentValidationError("Animated GIF files are not supported.");
      }
      break;
    case "application/pdf":
      if (!asciiIncludes(bytes.slice(0, 5), "%PDF-")) invalid();
      break;
    case "text/plain":
    case "text/markdown":
    case "text/csv":
    case "application/json": {
      if (bytes.includes(0)) invalid();
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new UploadedAttachmentValidationError("Text attachments must use UTF-8 encoding.");
      }
      if (mediaType === "application/json") {
        try {
          JSON.parse(decoded);
        } catch {
          throw new UploadedAttachmentValidationError("The JSON attachment is not valid JSON.");
        }
      }
      break;
    }
  }
}

export async function verifyUploadedAttachment(
  attachment: Pick<ChatAttachment, "pathname" | "mediaType" | "size">,
): Promise<{ etag: string }> {
  const result = await get(attachment.pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new UploadedAttachmentValidationError("The uploaded file could not be found.");
  if (result.blob.size !== attachment.size) throw new UploadedAttachmentValidationError("The uploaded file size does not match the request.");
  if (result.blob.contentType.toLowerCase().split(";", 1)[0] !== attachment.mediaType) {
    throw new UploadedAttachmentValidationError("The uploaded file content type does not match the request.");
  }

  const maximumBytes = attachment.mediaType.startsWith("text/") || attachment.mediaType === "application/json"
    ? MAX_TEXT_ATTACHMENT_BYTES
    : MAX_IMAGE_OR_PDF_BYTES;
  const bytes = await readStream(result.stream, maximumBytes);
  validateFileSignature(bytes, attachment.mediaType as AttachmentMediaType);
  return { etag: result.blob.etag };
}

import "server-only";

import { del, get, issueSignedToken, presignUrl } from "@vercel/blob";
import type { ChatAttachment } from "@prisma/client";
import { parseBuffer } from "music-metadata";
import {
  type AttachmentMediaType,
  type ChatAttachmentDescriptor,
  MAX_AUDIO_SECONDS,
  maxBytesFor,
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
  attachment: Pick<ChatAttachment, "id" | "filename" | "mediaType" | "size" | "pathname"> &
    Partial<Pick<ChatAttachment, "transcript" | "durationSeconds">>,
): Promise<ChatAttachmentDescriptor> {
  const preview = await createAttachmentPreviewUrl(attachment.pathname);
  return {
    id: attachment.id,
    filename: attachment.filename,
    mediaType: attachment.mediaType as AttachmentMediaType,
    size: attachment.size,
    ...preview,
    ...(attachment.transcript != null ? { transcript: attachment.transcript } : {}),
    ...(attachment.durationSeconds != null ? { durationSeconds: attachment.durationSeconds } : {}),
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
    case "audio/ogg":
      if (!asciiIncludes(bytes.slice(0, 4), "OggS")) invalid();
      break;
    case "audio/mpeg":
      // An ID3 tag, or straight into an MPEG audio frame (11 sync bits).
      if (!(asciiIncludes(bytes.slice(0, 3), "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) invalid();
      break;
    case "audio/mp4":
      if (!asciiIncludes(bytes.slice(4, 8), "ftyp")) invalid();
      break;
    case "audio/wav":
      if (!(asciiIncludes(bytes.slice(0, 4), "RIFF") && asciiIncludes(bytes.slice(8, 12), "WAVE"))) invalid();
      break;
    case "audio/webm":
      if (!startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) invalid();
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

/**
 * The length of an audio file in seconds, read from its container before any
 * transcription is paid for. Refuses a file whose length cannot be read or that
 * runs past MAX_AUDIO_SECONDS.
 */
export async function readAudioDurationSeconds(bytes: Uint8Array, mediaType: string): Promise<number> {
  let duration: number | undefined;
  try {
    const metadata = await parseBuffer(bytes, { mimeType: mediaType, size: bytes.byteLength }, { duration: true });
    duration = metadata.format.duration;
  } catch {
    duration = undefined;
  }
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    throw new UploadedAttachmentValidationError("Couldn't read the length of this audio file.");
  }
  if (duration > MAX_AUDIO_SECONDS) {
    throw new UploadedAttachmentValidationError(
      `Voice messages can be up to ${MAX_AUDIO_SECONDS / 60} minutes long.`,
    );
  }
  return Math.round(duration * 10) / 10;
}

/**
 * Check an uploaded blob against what was requested (size, type, signature).
 * Returns the bytes too, so an audio upload can be measured and transcribed
 * without a second download.
 */
export async function verifyUploadedAttachment(
  attachment: Pick<ChatAttachment, "pathname" | "mediaType" | "size">,
): Promise<{ etag: string; bytes: Uint8Array }> {
  const result = await get(attachment.pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new UploadedAttachmentValidationError("The uploaded file could not be found.");
  if (result.blob.size !== attachment.size) throw new UploadedAttachmentValidationError("The uploaded file size does not match the request.");
  if (result.blob.contentType.toLowerCase().split(";", 1)[0] !== attachment.mediaType) {
    throw new UploadedAttachmentValidationError("The uploaded file content type does not match the request.");
  }

  const bytes = await readStream(result.stream, maxBytesFor(attachment.mediaType as AttachmentMediaType));
  validateFileSignature(bytes, attachment.mediaType as AttachmentMediaType);
  return { etag: result.blob.etag, bytes };
}


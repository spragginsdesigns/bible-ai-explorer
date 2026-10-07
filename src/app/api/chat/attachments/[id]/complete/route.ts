import { ChatAttachmentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { isAudioMediaType } from "@/lib/chat-attachment-types";
import {
  deleteAttachmentBlob,
  readAudioDurationSeconds,
  toAttachmentDescriptor,
  UploadedAttachmentValidationError,
  verifyUploadedAttachment,
} from "@/lib/chat-attachments.server";
import { audioQuotaDecision, freeDailyAudioSeconds } from "@/lib/audio-transcription-rules";
import { AudioTranscriptionUnavailableError, transcribeAudio } from "@/lib/audio-transcription";
import { getUserPlan } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";

// A voice message is transcribed before this returns; 15 minutes of audio
// takes well under a minute, so this leaves room for a retry.
export const maxDuration = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Not a bad file, just one this account cannot transcribe right now. */
class AudioNotAllowedError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "AudioNotAllowedError";
  }
}

/** Seconds of voice messages this user had transcribed in the last 24 hours. */
async function audioSecondsUsedToday(userId: string): Promise<number> {
  const used = await prisma.chatAttachment.aggregate({
    where: {
      userId,
      status: ChatAttachmentStatus.READY,
      durationSeconds: { not: null },
      readyAt: { gte: new Date(Date.now() - DAY_MS) },
    },
    _sum: { durationSeconds: true },
  });
  return used._sum.durationSeconds ?? 0;
}

/**
 * Measure, check the allowance, then transcribe. Order matters: nothing is paid
 * for until the file has proved it is audio of an allowed length and the
 * account has room for all of it.
 */
async function transcribeVoiceMessage(
  userId: string,
  bytes: Uint8Array,
  mediaType: string,
): Promise<{ transcript: string; durationSeconds: number }> {
  const durationSeconds = await readAudioDurationSeconds(bytes, mediaType);
  const [plan, usedSeconds] = await Promise.all([getUserPlan(userId), audioSecondsUsedToday(userId)]);
  const decision = audioQuotaDecision({
    plan,
    usedSeconds,
    newSeconds: durationSeconds,
    capSeconds: freeDailyAudioSeconds(process.env),
  });
  if (!decision.ok) throw new AudioNotAllowedError(decision.message, 429, "audio_quota");
  try {
    return { transcript: await transcribeAudio(bytes), durationSeconds };
  } catch (error) {
    if (error instanceof AudioTranscriptionUnavailableError) {
      throw new AudioNotAllowedError(error.message, 503, "audio_unavailable");
    }
    console.error("Voice message transcription failed:", error);
    throw new AudioNotAllowedError("Couldn't transcribe this voice message. Try again in a moment.", 502, "audio_failed");
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getAuthUser();
    const { id } = await params;
    const attachment = await prisma.chatAttachment.findFirst({ where: { id, userId } });
    if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    if (attachment.messageId) {
      return NextResponse.json({ error: "This attachment is already part of a message." }, { status: 409 });
    }
    if (attachment.status === ChatAttachmentStatus.READY) {
      return NextResponse.json({ attachment: await toAttachmentDescriptor(attachment) });
    }

    try {
      const { etag, bytes } = await verifyUploadedAttachment(attachment);
      const audio = isAudioMediaType(attachment.mediaType)
        ? await transcribeVoiceMessage(userId, bytes, attachment.mediaType)
        : null;
      const ready = await prisma.chatAttachment.update({
        where: { id: attachment.id },
        data: {
          status: ChatAttachmentStatus.READY,
          readyAt: new Date(),
          etag,
          ...(audio ? { transcript: audio.transcript, durationSeconds: audio.durationSeconds } : {}),
        },
      });
      return NextResponse.json({ attachment: await toAttachmentDescriptor(ready) });
    } catch (error) {
      if (!(error instanceof UploadedAttachmentValidationError) && !(error instanceof AudioNotAllowedError)) {
        throw error;
      }
      await deleteAttachmentBlob(attachment.pathname).catch(() => undefined);
      await prisma.chatAttachment.delete({ where: { id: attachment.id } }).catch(() => undefined);
      if (error instanceof AudioNotAllowedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "The uploaded file is invalid." },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Attachment completion failed:", error);
    return NextResponse.json({ error: "Could not finish the upload." }, { status: 500 });
  }
}

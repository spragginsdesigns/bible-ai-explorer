import { randomUUID } from "node:crypto";
import { type ChatAttachment, ChatAttachmentStatus, Prisma } from "@prisma/client";
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
import { freeDailyAudioSeconds } from "@/lib/audio-transcription-rules";
import { releaseAudioReservation, reserveAudioSeconds } from "@/lib/audio-transcription-usage";
import { AudioTranscriptionUnavailableError, transcribeAudio } from "@/lib/audio-transcription";
import { platformFromHeaders } from "@/lib/analytics/events";
import { getUserPlan } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";

// A voice message is transcribed before this returns; 15 minutes of audio
// takes well under a minute, so this leaves room for a retry.
export const maxDuration = 120;

/**
 * A claim older than one whole request belongs to a request the platform has
 * already killed, so it is safe to take over.
 */
const STALE_CLAIM_MS = (maxDuration + 5) * 1000;
/**
 * The paid work needs time to finish inside this request: verify, measure and
 * transcribe up to 15 minutes of audio takes well under a minute. A request
 * past this point no longer claims (it would be killed mid-transcription,
 * leaving a charge and no transcript) and answers "still processing" instead.
 */
const LATEST_CLAIM_MS = (maxDuration - 60) * 1000;
const WAIT_POLL_MS = 1000;

/** Not a bad file, just one this account cannot transcribe right now. */
class AudioNotAllowedError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "AudioNotAllowedError";
  }
}

/**
 * Take the right to verify (and for audio, pay to transcribe) this upload. One
 * conditional update, so of any number of parallel requests exactly one wins;
 * the rest wait for it in claimOrWait instead of paying again.
 */
async function claimAttachment(id: string, userId: string): Promise<string | null> {
  const token = randomUUID();
  const now = Date.now();
  const claimed = await prisma.chatAttachment.updateMany({
    where: {
      id,
      userId,
      messageId: null,
      status: ChatAttachmentStatus.PENDING,
      OR: [{ processingToken: null }, { processingAt: { lt: new Date(now - STALE_CLAIM_MS) } }],
    },
    data: { processingToken: token, processingAt: new Date(now) },
  });
  return claimed.count === 1 ? token : null;
}

type ClaimOutcome = { token: string } | { response: NextResponse };

/**
 * Claim the upload, or answer the way the request that holds the claim will:
 * a retry or a double tap gets the finished attachment, not a second paid
 * transcription and not an error the clients were never written to expect.
 */
async function claimOrWait(id: string, userId: string, startedAt: number): Promise<ClaimOutcome> {
  const deadline = startedAt + LATEST_CLAIM_MS;
  for (;;) {
    if (Date.now() >= deadline) {
      return { response: NextResponse.json({ error: "This upload is still being processed. Try again in a moment." }, { status: 409 }) };
    }
    const token = await claimAttachment(id, userId);
    if (token) return { token };
    const current = await prisma.chatAttachment.findFirst({ where: { id, userId } });
    if (!current) {
      return {
        response: NextResponse.json({ error: "This upload could not be finished. Try attaching it again." }, { status: 409 }),
      };
    }
    if (current.messageId) {
      return { response: NextResponse.json({ error: "This attachment is already part of a message." }, { status: 409 }) };
    }
    if (current.status === ChatAttachmentStatus.READY) {
      return { response: NextResponse.json({ attachment: await toAttachmentDescriptor(current) }) };
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

/**
 * Measure, reserve the allowance, then transcribe. Order matters: nothing is
 * paid for until the file has proved it is audio of an allowed length and the
 * seconds are booked in the usage ledger, which is what the next upload's
 * check reads. A failed transcription hands its reservation back.
 */
async function transcribeVoiceMessage(
  userId: string,
  attachmentId: string,
  bytes: Uint8Array,
  mediaType: string,
  mentionPro: boolean,
): Promise<{ transcript: string; durationSeconds: number }> {
  const durationSeconds = await readAudioDurationSeconds(bytes, mediaType);
  const decision = await reserveAudioSeconds({
    userId,
    attachmentId,
    seconds: durationSeconds,
    plan: await getUserPlan(userId),
    capSeconds: freeDailyAudioSeconds(process.env),
    mentionPro,
  });
  if (!decision.ok) throw new AudioNotAllowedError(decision.message, 429, "audio_quota");
  try {
    return { transcript: await transcribeAudio(bytes), durationSeconds };
  } catch (error) {
    await releaseAudioReservation(userId, attachmentId).catch(() => undefined);
    if (error instanceof AudioTranscriptionUnavailableError) {
      throw new AudioNotAllowedError(error.message, 503, "audio_unavailable");
    }
    console.error("Voice message transcription failed:", error);
    throw new AudioNotAllowedError("Couldn't transcribe this voice message. Try again in a moment.", 502, "audio_failed");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
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

    const claim = await claimOrWait(id, userId, startedAt);
    if ("response" in claim) return claim.response;
    return await finishClaimedAttachment(request, attachment, claim.token);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Attachment completion failed:", error);
    return NextResponse.json({ error: "Could not finish the upload." }, { status: 500 });
  }
}

async function finishClaimedAttachment(
  request: Request,
  attachment: ChatAttachment,
  token: string,
): Promise<NextResponse> {
  const owned = { id: attachment.id, processingToken: token };
  try {
    const { etag, bytes } = await verifyUploadedAttachment(attachment);
    const audio = isAudioMediaType(attachment.mediaType)
      ? await transcribeVoiceMessage(
          attachment.userId,
          attachment.id,
          bytes,
          attachment.mediaType,
          platformFromHeaders(request.headers) !== "ios",
        )
      : null;
    const ready = await prisma.chatAttachment.update({
      where: owned,
      data: {
        status: ChatAttachmentStatus.READY,
        readyAt: new Date(),
        etag,
        processingToken: null,
        processingAt: null,
        ...(audio ? { transcript: audio.transcript, durationSeconds: audio.durationSeconds } : {}),
      },
    });
    return NextResponse.json({ attachment: await toAttachmentDescriptor(ready) });
  } catch (error) {
    // Removed (or taken over after a stall) while this request was working.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "This upload could not be finished. Try attaching it again." }, { status: 409 });
    }
    if (!(error instanceof UploadedAttachmentValidationError) && !(error instanceof AudioNotAllowedError)) {
      // Unexpected: let a retry start over now rather than after the claim goes stale.
      await prisma.chatAttachment
        .updateMany({ where: owned, data: { processingToken: null, processingAt: null } })
        .catch(() => undefined);
      throw error;
    }
    await deleteAttachmentBlob(attachment.pathname).catch(() => undefined);
    await prisma.chatAttachment.deleteMany({ where: owned }).catch(() => undefined);
    if (error instanceof AudioNotAllowedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The uploaded file is invalid." },
      { status: 400 },
    );
  }
}

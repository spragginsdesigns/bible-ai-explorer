import { NextResponse } from "next/server";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";
import { GUEST_RETENTION_DAYS } from "@/lib/guest-rules";
import { PENDING_ATTACHMENT_WINDOW_MS } from "@/lib/chat-attachment-types";

// Room for a long drain; the sweep stops itself well before this.
export const maxDuration = 300;

const CLEANUP_PAGE_SIZE = 100;
const CLEANUP_BUDGET_MS = 240 * 1000;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Drain page by page until nothing stale is left or the time budget runs
  // out; a fixed 100 a day let a burst of abandoned uploads outlive the sweep.
  const cutoff = new Date(Date.now() - PENDING_ATTACHMENT_WINDOW_MS);
  const stopAt = Date.now() + CLEANUP_BUDGET_MS;
  const failed = new Set<string>();
  let checked = 0;
  let deleted = 0;
  while (Date.now() < stopAt) {
    const stale = await prisma.chatAttachment.findMany({
      where: { messageId: null, createdAt: { lt: cutoff }, id: { notIn: [...failed] } },
      orderBy: { createdAt: "asc" },
      take: CLEANUP_PAGE_SIZE,
    });
    if (stale.length === 0) break;
    checked += stale.length;
    for (const attachment of stale) {
      if (Date.now() >= stopAt) break;
      try {
        await deleteAttachmentBlob(attachment.pathname, attachment.etag);
        await prisma.chatAttachment.delete({ where: { id: attachment.id } });
        deleted += 1;
      } catch (error) {
        failed.add(attachment.id);
        console.error(`Could not clean up attachment ${attachment.id}:`, error);
      }
    }
  }

  // Guest turns nobody claimed by signing up (docs/FEATURES.md, "Try before
  // you sign up"). The privacy page promises 30 days; claimed rows go too,
  // since their text now lives in the account's own conversation.
  const guestCutoff = new Date(Date.now() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let guestTurnsDeleted = 0;
  try {
    const expired = await prisma.guestTurn.deleteMany({ where: { createdAt: { lt: guestCutoff } } });
    guestTurnsDeleted = expired.count;
  } catch (error) {
    console.error("Could not clean up guest turns:", error);
  }

  // Church save events only ever answer "how many in the last hour"; a day of
  // history is plenty and keeps the table from growing.
  let churchSaveEventsDeleted = 0;
  try {
    const expired = await prisma.churchSaveEvent.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    churchSaveEventsDeleted = expired.count;
  } catch (error) {
    console.error("Could not clean up church save events:", error);
  }

  return NextResponse.json({ checked, deleted, guestTurnsDeleted, churchSaveEventsDeleted });
}

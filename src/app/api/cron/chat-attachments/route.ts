import { NextResponse } from "next/server";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";
import { GUEST_RETENTION_DAYS } from "@/lib/guest-rules";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.chatAttachment.findMany({
    where: { messageId: null, createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let deleted = 0;
  for (const attachment of stale) {
    try {
      await deleteAttachmentBlob(attachment.pathname, attachment.etag);
      await prisma.chatAttachment.delete({ where: { id: attachment.id } });
      deleted += 1;
    } catch (error) {
      console.error(`Could not clean up attachment ${attachment.id}:`, error);
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

  return NextResponse.json({ checked: stale.length, deleted, guestTurnsDeleted });
}

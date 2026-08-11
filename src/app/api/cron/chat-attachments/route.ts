import { NextResponse } from "next/server";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({ checked: stale.length, deleted });
}

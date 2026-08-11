import { ChatAttachmentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  deleteAttachmentBlob,
  toAttachmentDescriptor,
  UploadedAttachmentValidationError,
  verifyUploadedAttachment,
} from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";

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
      const { etag } = await verifyUploadedAttachment(attachment);
      const ready = await prisma.chatAttachment.update({
        where: { id: attachment.id },
        data: { status: ChatAttachmentStatus.READY, readyAt: new Date(), etag },
      });
      return NextResponse.json({ attachment: await toAttachmentDescriptor(ready) });
    } catch (error) {
      if (!(error instanceof UploadedAttachmentValidationError)) throw error;
      await deleteAttachmentBlob(attachment.pathname).catch(() => undefined);
      await prisma.chatAttachment.delete({ where: { id: attachment.id } }).catch(() => undefined);
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

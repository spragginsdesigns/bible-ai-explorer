import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getAuthUser();
    const { id } = await params;
    const attachment = await prisma.chatAttachment.findFirst({ where: { id, userId } });
    if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    if (attachment.messageId) {
      return NextResponse.json({ error: "Sent attachments cannot be removed individually." }, { status: 409 });
    }

    await deleteAttachmentBlob(attachment.pathname, attachment.etag);
    await prisma.chatAttachment.delete({ where: { id: attachment.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Attachment deletion failed:", error);
    return NextResponse.json({ error: "Could not remove the attachment." }, { status: 500 });
  }
}

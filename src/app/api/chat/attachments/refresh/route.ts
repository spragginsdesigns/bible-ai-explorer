import { ChatAttachmentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { toAttachmentDescriptor } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const userId = await getAuthUserId();
    const body = await request.json();
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids: string[] = [
      ...new Set(rawIds.filter((id): id is string => typeof id === "string")),
    ];
    if (ids.length === 0 || ids.length > 25) {
      return NextResponse.json({ error: "Request between 1 and 25 attachment IDs." }, { status: 400 });
    }

    const records = await prisma.chatAttachment.findMany({
      where: { id: { in: ids }, userId, status: ChatAttachmentStatus.READY },
    });
    const attachments = await Promise.all(records.map(toAttachmentDescriptor));
    return NextResponse.json({ attachments });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Attachment URL refresh failed:", error);
    return NextResponse.json({ error: "Could not refresh attachment access." }, { status: 500 });
  }
}

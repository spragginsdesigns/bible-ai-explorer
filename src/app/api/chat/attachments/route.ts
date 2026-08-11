import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  AttachmentValidationError,
  sanitizeAttachmentFilename,
  validateAttachmentBatch,
} from "@/lib/chat-attachment-types";
import { createAttachmentUploadUrl } from "@/lib/chat-attachments.server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  let createdIds: string[] = [];
  try {
    const userId = await getAuthUser();
    const body = await request.json();
    if (!body || !Array.isArray(body.files)) {
      return NextResponse.json({ error: "A files array is required." }, { status: 400 });
    }

    const files = validateAttachmentBatch(body.files);
    const records = files.map((file) => {
      const id = randomUUID();
      return {
        id,
        userId,
        pathname: `chat-attachments/${userId}/${id}/${sanitizeAttachmentFilename(file.filename)}`,
        filename: file.filename,
        mediaType: file.mediaType,
        size: file.size,
      };
    });

    await prisma.$transaction(
      records.map((record) => prisma.chatAttachment.create({ data: record })),
    );
    createdIds = records.map((record) => record.id);

    const uploads = await Promise.all(
      records.map(async (record) => ({
        id: record.id,
        filename: record.filename,
        mediaType: record.mediaType,
        size: record.size,
        ...(await createAttachmentUploadUrl(record.pathname, record.mediaType, record.size)),
      })),
    );
    return NextResponse.json({ uploads }, { status: 201 });
  } catch (error) {
    if (createdIds.length > 0) {
      await prisma.chatAttachment.deleteMany({ where: { id: { in: createdIds }, messageId: null } });
    }
    if (error instanceof Response) return error;
    if (error instanceof AttachmentValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid request." },
        { status: 400 },
      );
    }
    console.error("Attachment upload initialization failed:", error);
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  }
}

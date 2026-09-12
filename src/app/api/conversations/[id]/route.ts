import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { deleteAttachmentBlobs, toAttachmentDescriptor } from "@/lib/chat-attachments.server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
			include: {
				messages: {
					orderBy: { createdAt: "asc" },
					include: { attachments: true },
				},
			},
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		const messages = await Promise.all(conversation.messages.map(async (message) => ({
			...message,
			attachments: await Promise.all(message.attachments.map(toAttachmentDescriptor)),
		})));
		return NextResponse.json({ ...conversation, messages });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

const MAX_CONVERSATION_TITLE_LENGTH = 120;

/**
 * Rename a conversation. Title only: a rename also stops the one-time
 * automatic title (conversation-title.ts writes only while the title is still
 * the raw first-message truncation, guarded by the old value).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const body: unknown = await req.json().catch(() => null);
		const rawTitle =
			typeof body === "object" && body !== null && "title" in body ? (body as { title: unknown }).title : undefined;
		const title = typeof rawTitle === "string" ? rawTitle.replace(/\s+/g, " ").trim() : "";
		if (!title || title.length > MAX_CONVERSATION_TITLE_LENGTH) {
			return NextResponse.json(
				{ error: `Title must be 1 to ${MAX_CONVERSATION_TITLE_LENGTH} characters.` },
				{ status: 400 },
			);
		}
		const result = await prisma.conversation.updateMany({ where: { id, userId }, data: { title } });
		if (result.count === 0) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
			select: { id: true, title: true, createdAt: true, updatedAt: true },
		});
		return NextResponse.json(conversation);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
			include: {
				messages: {
					select: { attachments: { select: { pathname: true } } },
				},
			},
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		const pathnames = conversation.messages.flatMap((message) =>
			message.attachments.map((attachment) => attachment.pathname),
		);
		await deleteAttachmentBlobs(pathnames);
		await prisma.conversation.delete({ where: { id } });
		return NextResponse.json({ success: true });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

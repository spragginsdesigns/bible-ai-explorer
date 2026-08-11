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

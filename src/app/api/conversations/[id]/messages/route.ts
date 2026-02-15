import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
	try {
		const userId = await getAuthUser();
		const conversation = await prisma.conversation.findFirst({
			where: { id: params.id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const { messages } = await req.json();
		// Accept single message or array of messages
		const msgArray = Array.isArray(messages) ? messages : [messages];

		const created = await prisma.message.createMany({
			data: msgArray.map((m: { role: string; content: string; metadata?: Prisma.InputJsonValue }) => ({
				role: m.role,
				content: m.content,
				metadata: m.metadata ?? Prisma.JsonNull,
				conversationId: params.id,
			})),
		});

		// Also touch the conversation's updatedAt
		await prisma.conversation.update({
			where: { id: params.id },
			data: { updatedAt: new Date() },
		});

		// Return the created messages
		const latestMessages = await prisma.message.findMany({
			where: { conversationId: params.id },
			orderBy: { createdAt: "desc" },
			take: msgArray.length,
		});

		return NextResponse.json(latestMessages.reverse(), { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

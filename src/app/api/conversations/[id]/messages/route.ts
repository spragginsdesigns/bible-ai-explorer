import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { z } from "zod";

const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string().min(1).max(50_000),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.object({
	messages: z.union([messageSchema, z.array(messageSchema).min(1).max(20)]),
});
const MAX_BODY_BYTES = 1_000_000;

async function readLimitedBody(req: Request): Promise<string | null> {
	const length = Number(req.headers.get("content-length"));
	if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
	if (!req.body) return "";
	const reader = req.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let raw = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		raw += decoder.decode(value, { stream: true });
	}
	return raw + decoder.decode();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const rawBody = await readLimitedBody(req);
		if (rawBody === null) {
			return NextResponse.json({ error: "Request is too large" }, { status: 413 });
		}
		let body: unknown;
		try { body = JSON.parse(rawBody); } catch {
			return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
		}
		const parsed = bodySchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
		}
		const { messages } = parsed.data;
		// Accept single message or array of messages
		const msgArray = Array.isArray(messages) ? messages : [messages];

		const created = await prisma.message.createMany({
			data: msgArray.map((m) => ({
				role: m.role,
				content: m.content,
				metadata: m.metadata ? m.metadata as Prisma.InputJsonValue : Prisma.JsonNull,
				conversationId: id,
			})),
		});

		// Also touch the conversation's updatedAt
		await prisma.conversation.update({
			where: { id },
			data: { updatedAt: new Date() },
		});

		// Return the created messages
		const latestMessages = await prisma.message.findMany({
			where: { conversationId: id },
			orderBy: { createdAt: "desc" },
			take: msgArray.length,
		});

		return NextResponse.json(latestMessages.reverse(), { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

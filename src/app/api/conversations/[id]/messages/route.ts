import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { z } from "zod";
import { randomUUID } from "node:crypto";

// User rows only. An assistant row is SureWord's words: the share route
// publishes it on a public page as a genuine answer, so only the server's own
// answer paths (ask-question, guest claim) may write one. No client has posted
// here since the web moved to the ask-question persist on 2026-08-09.
const messageSchema = z.object({
	role: z.literal("user"),
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

		const rows = msgArray.map((m) => ({
				id: randomUUID(),
				role: m.role,
				content: m.content,
				metadata: m.metadata ? m.metadata as Prisma.InputJsonValue : Prisma.JsonNull,
				conversationId: id,
			}));
		await prisma.message.createMany({
			data: rows,
		});

		// Also touch the conversation's updatedAt
		await prisma.conversation.update({
			where: { id },
			data: { updatedAt: new Date() },
		});

		// Another request may have saved an assistant after this insert. Bind
		// the reply to these exact new user rows, never the latest chat rows.
		const createdMessages = await prisma.message.findMany({
			where: { conversationId: id, role: "user", id: { in: rows.map((row) => row.id) } },
		});
		const byId = new Map(createdMessages.filter((row) => row.role === "user" && row.conversationId === id).map((row) => [row.id, row]));
		return NextResponse.json(rows.flatMap((row) => byId.has(row.id) ? [byId.get(row.id)!] : []), { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

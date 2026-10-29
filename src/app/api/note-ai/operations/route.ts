import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rateLimit";
import { NoteAIOperationError, noteAIOperationId, noteAIRequestHash, reserveNoteAIOperation } from "@/lib/note-ai-operations";

const limiter = createRateLimiter({ limit: 20, windowMs: 5 * 60_000 });

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const rate = limiter.check(userId);
		if (!rate.allowed) return NextResponse.json({ error: "Too many note requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
		const raw = await req.text();
		if (Buffer.byteLength(raw, "utf8") > 1_000_000) return NextResponse.json({ error: "The note request is too large." }, { status: 413 });
		let body: Record<string, unknown>;
		try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
		if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.noteId !== "string" || !body.noteId || body.noteId.length > 128 || !Array.isArray(body.messages) || !body.messages.length) {
			return NextResponse.json({ error: "A note and its messages are required." }, { status: 400 });
		}
		const id = noteAIOperationId(body.operationId);
		const receipt = await reserveNoteAIOperation({ id, userId, noteId: body.noteId }, noteAIRequestHash(body));
		return NextResponse.json(receipt, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof NoteAIOperationError) return NextResponse.json({ error: error.message }, { status: error.status });
		console.error("Note operation reservation failed.", error instanceof Error ? error.name : "UnknownError");
		return NextResponse.json({ error: "The note request could not be prepared." }, { status: 500 });
	}
}

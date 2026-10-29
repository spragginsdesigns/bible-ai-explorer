import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { NoteAIOperationError, noteAIOperationId, cancelNoteAIOperation } from "@/lib/note-ai-operations";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const id = noteAIOperationId((await params).id);
		let body: { noteId?: unknown } | null;
		try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
		if (!body || typeof body.noteId !== "string" || !body.noteId || body.noteId.length > 128) return NextResponse.json({ error: "A note is required." }, { status: 400 });
		return NextResponse.json(await cancelNoteAIOperation({ id, userId, noteId: body.noteId }), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof NoteAIOperationError) return NextResponse.json({ error: error.message }, { status: error.status });
		console.error("Note operation cancellation failed.", error instanceof Error ? error.name : "UnknownError");
		return NextResponse.json({ error: "The note request could not be stopped safely. Try checking it again." }, { status: 500 });
	}
}

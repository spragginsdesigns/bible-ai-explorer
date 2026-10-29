import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { NoteAIOperationError, noteAIOperationId, readNoteAIOperation } from "@/lib/note-ai-operations";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const id = noteAIOperationId((await params).id);
		const noteId = new URL(req.url).searchParams.get("noteId");
		if (!noteId || noteId.length > 128) return NextResponse.json({ error: "A note is required." }, { status: 400 });
		return NextResponse.json(await readNoteAIOperation({ id, userId, noteId }), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof NoteAIOperationError) return NextResponse.json({ error: error.message }, { status: error.status });
		return NextResponse.json({ error: "The note request could not be checked." }, { status: 500 });
	}
}

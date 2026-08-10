import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { appendMarkdownToNote } from "@/lib/notes-io";

// Whole chat answers can be much longer than an AI addToNote tool call
// (which uses the 8000-char default in notes-io).
const MAX_APPEND_MARKDOWN_LENGTH = 32000;

/**
 * Append markdown to an existing note, or create a new note when noteId is
 * omitted. Shared by the web "Add to notes" action and the mobile client.
 *
 * Body: { markdown: string (required), noteId?: string | null, title?: string }
 * 200:  { noteId, noteTitle, created }
 */
export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const body = await req.json().catch(() => null);

		const markdown =
			body && typeof body.markdown === "string" ? body.markdown : "";
		if (!markdown.trim()) {
			return NextResponse.json(
				{ error: "markdown is required" },
				{ status: 400 }
			);
		}

		const noteId =
			body && typeof body.noteId === "string" && body.noteId
				? body.noteId
				: undefined;
		const title =
			body && typeof body.title === "string" ? body.title : undefined;

		const result = await appendMarkdownToNote({
			userId,
			markdown,
			noteId,
			title,
			maxLength: MAX_APPEND_MARKDOWN_LENGTH,
		});

		return NextResponse.json({
			noteId: result.noteId,
			noteTitle: result.noteTitle,
			created: result.created,
		});
	} catch (err) {
		if (err instanceof Response) return err;
		if (err instanceof Error) {
			if (err.message === "Note not found.") {
				return NextResponse.json({ error: "Note not found" }, { status: 404 });
			}
			if (err.message.startsWith("Nothing to add")) {
				return NextResponse.json({ error: err.message }, { status: 400 });
			}
		}
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

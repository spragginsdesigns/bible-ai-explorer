import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { composeNoteFromAnswer } from "@/lib/note-composer";
import { appendMarkdownToNote } from "@/lib/notes-io";

// Whole chat answers can be much longer than an AI addToNote tool call
// (which uses the 8000-char default in notes-io).
const MAX_APPEND_MARKDOWN_LENGTH = 32000;

// The composer's own budget is 45s (see note-composer), and Prisma writes plus
// the embedding sync follow it.
export const maxDuration = 90;

/**
 * Append markdown to an existing note, or create a new note when noteId is
 * omitted. Shared by the web "Add to notes" action and the mobile client.
 *
 * This is the "Add to notes" path, so the answer is rewritten into the user's
 * own study journal before it is stored (see @/lib/note-composer). Pass
 * `compose: false` to store exactly what was sent, which is what a caller
 * saving already-composed content wants. The assistant's own `addToNote` tool
 * does not come through here at all - it calls appendMarkdownToNote directly
 * with content it already wrote in the house style.
 *
 * Body: { markdown: string (required), noteId?: string | null, title?: string,
 *         conversationId?: string, compose?: boolean }
 * 200:  { noteId, noteTitle, created, composed }
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
		const conversationId =
			body && typeof body.conversationId === "string" && body.conversationId
				? body.conversationId
				: undefined;
		// Composition is the default: every caller of this route today is a user
		// tapping "Add to notes" on an answer written for the chat, not for a note.
		const compose = !(body && body.compose === false);

		const composed = compose
			? await composeNoteFromAnswer({ userId, markdown, noteId, conversationId })
			: null;

		const result = await appendMarkdownToNote({
			userId,
			markdown: composed?.markdown ?? markdown,
			noteId,
			// The composed title names the note; the client's conversation title (a
			// 60-character slice of the question) is the fallback.
			title: composed?.title ?? title,
			maxLength: MAX_APPEND_MARKDOWN_LENGTH,
		});

		return NextResponse.json({
			noteId: result.noteId,
			noteTitle: result.noteTitle,
			created: result.created,
			// False when the answer was stored verbatim, either because the caller
			// asked for that or because composition failed.
			composed: composed?.composed ?? false,
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

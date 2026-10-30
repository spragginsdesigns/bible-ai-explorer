import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { composeNoteFromAnswer, COMPOSE_WORKFLOW_MS } from "@/lib/note-composer";
import { appendMarkdownToNote } from "@/lib/notes-io";

// Whole chat answers can be much longer than an AI addToNote tool call
// (which uses the 8000-char default in notes-io).
const MAX_APPEND_MARKDOWN_LENGTH = 32000;

// The 150s workflow reserves 45s composition, 75s checking and 30s persistence.
// The route and clients allow transport margin outside that workflow.
export const maxDuration = 180;

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
import { withIncludedAiRequest } from "@/lib/billing/usage";
export const POST = withIncludedAiRequest(handlePost, "note-compose");

async function handlePost(req: Request) {
	try {
		const deadlineAt = Date.now() + COMPOSE_WORKFLOW_MS;
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

		if (markdown.length > MAX_APPEND_MARKDOWN_LENGTH) return NextResponse.json({ error: "This note is too long to save without cutting its content." }, { status: 400 });

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
			? await composeNoteFromAnswer({ userId, markdown, noteId, conversationId, deadlineAt, signal: req.signal })
			: null;

		if (req.signal.aborted) return NextResponse.json({ error: "The request was cancelled before saving." }, { status: 499 });

		if (compose && (!composed || !composed.composed)) {
			return NextResponse.json({ error: "The note could not be checked, so it was not saved. Please try again." }, { status: composed && !composed.composed && composed.reason === "not-found" ? 404 : 503 });
		}
		// An explicit compose:false request is user-verbatim provenance; it is
		// never represented as checked AI output or used after an AI failure.
		const save = composed?.composed
			? { markdown: composed.markdown, title: composed.title, provenance: composed.provenance }
			: { markdown, title, provenance: "user-verbatim" as const };
		if (save.markdown.length > MAX_APPEND_MARKDOWN_LENGTH) return NextResponse.json({ error: "This note is too long to save without cutting its content." }, { status: 400 });
		if (compose && Date.now() >= deadlineAt) return NextResponse.json({ error: "The note could not be checked in time, so it was not saved." }, { status: 503 });
		// This preflight stops already-aborted jobs, not a commit racing cancellation.
		if (req.signal.aborted) return NextResponse.json({ error: "The request was cancelled before saving." }, { status: 499 });
		const result = await appendMarkdownToNote({ userId, markdown: save.markdown, noteId, title: save.title, maxLength: MAX_APPEND_MARKDOWN_LENGTH });

		return NextResponse.json({
			noteId: result.noteId,
			noteTitle: result.noteTitle,
			created: result.created,
			// False only for the explicit user-verbatim path. AI failures never save.
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

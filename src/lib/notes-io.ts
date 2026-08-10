import { prisma } from "@/lib/prisma";
import { countWords, htmlToPlainText, markdownToNoteHtml } from "@/lib/markdown";

export interface AppendToNoteResult {
	noteId: string;
	noteTitle: string;
	appendedHtml: string;
	created: boolean;
}

const MAX_APPEND_MARKDOWN_LENGTH = 8000;

/**
 * Append AI-authored markdown to an existing note, or create a new note when
 * no noteId is given. The note's `content` field is set to the combined HTML
 * document: the Tiptap editor falls back to parsing HTML when the stored
 * content is not valid JSON, and the next user edit round-trips it back to
 * Tiptap JSON.
 */
export async function appendMarkdownToNote(options: {
	userId: string;
	markdown: string;
	noteId?: string;
	title?: string;
	/**
	 * Per-call markdown cap. Defaults to the AI tool-call limit; the
	 * /api/notes/append route passes a larger one for whole chat answers.
	 */
	maxLength?: number;
}): Promise<AppendToNoteResult> {
	const markdown = options.markdown.slice(
		0,
		options.maxLength ?? MAX_APPEND_MARKDOWN_LENGTH
	);
	const appendedHtml = markdownToNoteHtml(markdown);
	if (!appendedHtml) {
		throw new Error("Nothing to add: the provided content was empty.");
	}
	const appendedPlainText = htmlToPlainText(appendedHtml);

	if (options.noteId) {
		const note = await prisma.note.findFirst({
			where: { id: options.noteId, userId: options.userId },
		});
		if (!note) {
			throw new Error("Note not found.");
		}

		const htmlContent = note.htmlContent
			? `${note.htmlContent}\n${appendedHtml}`
			: appendedHtml;
		const plainText = note.plainText
			? `${note.plainText}\n\n${appendedPlainText}`
			: appendedPlainText;

		await prisma.note.update({
			where: { id: note.id },
			data: {
				htmlContent,
				plainText,
				content: htmlContent,
				wordCount: countWords(plainText),
			},
		});

		return {
			noteId: note.id,
			noteTitle: note.title,
			appendedHtml,
			created: false,
		};
	}

	const title = options.title?.trim() || "Note from VerseMind";
	const note = await prisma.note.create({
		data: {
			userId: options.userId,
			title,
			content: appendedHtml,
			htmlContent: appendedHtml,
			plainText: appendedPlainText,
			wordCount: countWords(appendedPlainText),
		},
	});

	return {
		noteId: note.id,
		noteTitle: note.title,
		appendedHtml,
		created: true,
	};
}

export interface NoteSummary {
	noteId: string;
	title: string;
	preview: string;
	updatedAt: string;
}

/** Search the user's notes by title and content for the addToNote tool. */
export async function findUserNotes(
	userId: string,
	query: string
): Promise<NoteSummary[]> {
	const trimmed = query.trim();
	const notes = await prisma.note.findMany({
		where: {
			userId,
			...(trimmed
				? {
						OR: [
							{ title: { contains: trimmed, mode: "insensitive" } },
							{ plainText: { contains: trimmed, mode: "insensitive" } },
						],
					}
				: {}),
		},
		orderBy: { updatedAt: "desc" },
		take: 8,
		select: { id: true, title: true, plainText: true, updatedAt: true },
	});

	return notes.map((note) => ({
		noteId: note.id,
		title: note.title,
		preview: note.plainText.slice(0, 160),
		updatedAt: note.updatedAt.toISOString(),
	}));
}

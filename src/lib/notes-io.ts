import { prisma } from "@/lib/prisma";
import { countWords, htmlToPlainText, markdownToNoteHtml } from "@/lib/markdown";
import { searchNoteEmbeddings, syncNoteEmbeddings } from "@/lib/note-embeddings";

export interface AppendToNoteResult {
	noteId: string;
	noteTitle: string;
	appendedHtml: string;
	created: boolean;
}

const MAX_APPEND_MARKDOWN_LENGTH = 8000;
const MAX_REWRITE_MARKDOWN_LENGTH = 24000;
const MAX_READ_CONTENT_LENGTH = 24000;

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
		await syncNoteEmbeddings({
			userId: options.userId,
			noteId: note.id,
			title: note.title,
			plainText,
		});

		return {
			noteId: note.id,
			noteTitle: note.title,
			appendedHtml,
			created: false,
		};
	}

	const title = options.title?.trim() || "Note from SureWord";
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
	await syncNoteEmbeddings({
		userId: options.userId,
		noteId: note.id,
		title,
		plainText: appendedPlainText,
	});

	return {
		noteId: note.id,
		noteTitle: note.title,
		appendedHtml,
		created: true,
	};
}

export interface NoteContent {
	noteId: string;
	title: string;
	/** The note body as HTML (what the editor renders), capped for the model. */
	htmlContent: string;
	truncated: boolean;
	wordCount: number;
	tags: string[];
	updatedAt: string;
}

/** Read a full note for the AI, including its body, so it can edit it faithfully. */
export async function readUserNote(
	userId: string,
	noteId: string
): Promise<NoteContent> {
	const note = await prisma.note.findFirst({
		where: { id: noteId, userId },
		include: { tags: { include: { tag: true } } },
	});
	if (!note) {
		throw new Error("Note not found.");
	}
	const html = note.htmlContent || note.plainText;
	return {
		noteId: note.id,
		title: note.title,
		htmlContent: html.slice(0, MAX_READ_CONTENT_LENGTH),
		truncated: html.length > MAX_READ_CONTENT_LENGTH,
		wordCount: note.wordCount,
		tags: note.tags.map((noteTag) => noteTag.tag.name),
		updatedAt: note.updatedAt.toISOString(),
	};
}

export interface RewriteNoteResult {
	noteId: string;
	noteTitle: string;
	previousWordCount: number;
	wordCount: number;
}

/**
 * Replace a note's entire body (and optionally its title) with AI-authored
 * markdown. This is the assistant's one destructive note operation, so the
 * tool layer requires the note to have been read in the same conversation
 * before calling it.
 */
export async function rewriteNote(options: {
	userId: string;
	noteId: string;
	markdown: string;
	title?: string;
}): Promise<RewriteNoteResult> {
	const markdown = options.markdown.slice(0, MAX_REWRITE_MARKDOWN_LENGTH);
	const htmlContent = markdownToNoteHtml(markdown);
	if (!htmlContent) {
		throw new Error("The rewritten content was empty; the note was left untouched.");
	}
	const plainText = htmlToPlainText(htmlContent);

	const note = await prisma.note.findFirst({
		where: { id: options.noteId, userId: options.userId },
		select: { id: true, title: true, wordCount: true, htmlContent: true, plainText: true },
	});
	if (!note) {
		throw new Error("Note not found.");
	}
	// readNote truncates very long notes, so a rewrite based on that read would
	// silently drop the tail. Refuse rather than destroy content.
	if ((note.htmlContent || note.plainText).length > MAX_READ_CONTENT_LENGTH) {
		throw new Error(
			"This note is too long to rewrite safely in one pass. Use addToNote for additions, or ask the user to split the note."
		);
	}

	const title = options.title?.trim() || note.title;
	await prisma.note.update({
		where: { id: note.id },
		data: {
			title,
			htmlContent,
			plainText,
			content: htmlContent,
			wordCount: countWords(plainText),
		},
	});
	await syncNoteEmbeddings({
		userId: options.userId,
		noteId: note.id,
		title,
		plainText,
	});

	return {
		noteId: note.id,
		noteTitle: title,
		previousWordCount: note.wordCount,
		wordCount: countWords(plainText),
	};
}

export interface NoteSummary {
	noteId: string;
	title: string;
	preview: string;
	updatedAt: string;
	/** Set when the note was found by meaning rather than exact wording. */
	matchedExcerpt?: string;
}

/**
 * Find the user's notes for the AI: exact title/content matches from Postgres
 * merged with semantic matches from the AstraDB note index, best matches
 * first. An empty query lists recent notes.
 */
export async function findUserNotes(
	userId: string,
	query: string
): Promise<NoteSummary[]> {
	const trimmed = query.trim();

	const [substringNotes, semanticHits] = await Promise.all([
		prisma.note.findMany({
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
		}),
		trimmed ? searchNoteEmbeddings(userId, trimmed) : Promise.resolve([]),
	]);

	const summaries = new Map<string, NoteSummary>();
	for (const note of substringNotes) {
		summaries.set(note.id, {
			noteId: note.id,
			title: note.title,
			preview: note.plainText.slice(0, 160),
			updatedAt: note.updatedAt.toISOString(),
		});
	}

	const newSemanticIds = semanticHits
		.filter((hit) => !summaries.has(hit.noteId))
		.map((hit) => hit.noteId);
	const semanticNotes = newSemanticIds.length > 0
		? await prisma.note.findMany({
				where: { userId, id: { in: newSemanticIds } },
				select: { id: true, title: true, plainText: true, updatedAt: true },
			})
		: [];
	const byId = new Map(semanticNotes.map((note) => [note.id, note]));
	for (const hit of semanticHits) {
		const existing = summaries.get(hit.noteId);
		if (existing) {
			if (!existing.matchedExcerpt) existing.matchedExcerpt = hit.excerpt;
			continue;
		}
		const note = byId.get(hit.noteId);
		if (!note) continue;
		summaries.set(note.id, {
			noteId: note.id,
			title: note.title,
			preview: note.plainText.slice(0, 160),
			updatedAt: note.updatedAt.toISOString(),
			matchedExcerpt: hit.excerpt,
		});
	}

	return [...summaries.values()].slice(0, 10);
}

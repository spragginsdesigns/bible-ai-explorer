import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { countWords, htmlToPlainText, markdownToNoteHtml } from "@/lib/markdown";
import { searchNoteEmbeddings, syncNoteEmbeddings } from "@/lib/note-embeddings";
import { resolvePendingLinks, syncNoteLinks, validateProperties, type NoteProperties } from "@/lib/note-links";
import { withNoteAIWrite, type NoteAIWriteOperation } from "@/lib/note-ai-operations";

/** Keep ordinary editor writes on their existing path; AI writes share one fence. */
async function withNoteWrite<T>(
	userId: string,
	operation: NoteAIWriteOperation | undefined,
	write: (db: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
	if (operation && operation.userId !== userId) {
		throw new Error("Note operation does not belong to this user.");
	}
	return operation ? withNoteAIWrite(operation, write) : write(prisma);
}

export interface AppendToNoteResult {
	noteId: string;
	noteTitle: string;
	appendedHtml: string;
	created: boolean;
	/**
	 * True when a new-note request was redirected into an existing note whose
	 * title matched the requested one (see findMatchingNoteTitle).
	 */
	matchedExisting: boolean;
}

const MAX_APPEND_MARKDOWN_LENGTH = 8000;
const MAX_REWRITE_MARKDOWN_LENGTH = 24000;
const MAX_READ_CONTENT_LENGTH = 24000;

/** How many of the user's most recently updated notes a title match considers. */
const TITLE_MATCH_CANDIDATE_LIMIT = 500;
const TITLE_MATCH_MIN_JACCARD = 0.75;
const PLACEHOLDER_TITLES = new Set(["untitled note", "untitled", "note from sureword", "new note"]);
const TITLE_STOPWORDS = new Set([
	"a", "an", "the", "and", "or", "of", "on", "in", "to", "for", "my", "our",
	"about", "from", "with", "note",
]);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeNoteTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** Meaningful title words, with a naive plural fold so "Books" meets "Book". */
export function noteTitleTokens(title: string): Set<string> {
	const tokens = new Set<string>();
	for (const word of normalizeNoteTitle(title).split(" ")) {
		if (!word) continue;
		const folded = word.length > 3 && /[^su]s$/.test(word) && !word.endsWith("is")
			? word.slice(0, -1)
			: word;
		if (!TITLE_STOPWORDS.has(folded)) tokens.add(folded);
	}
	return tokens;
}

/**
 * Similarity of two note titles in [0, 1]: 1 for the same title after
 * normalization, otherwise the Jaccard overlap of their meaningful words.
 * Titles whose numbers differ ("Week 1" vs "Week 2", "Romans 8" vs "Romans 9")
 * always score 0, because a series of notes must never collapse into one.
 */
export function noteTitleSimilarity(a: string, b: string): number {
	const normalizedA = normalizeNoteTitle(a);
	if (!normalizedA) return 0;
	// Placeholder titles name no subject: matching them would pour a new study
	// into whichever empty "Untitled Note" happened to be newest.
	if (PLACEHOLDER_TITLES.has(normalizedA) || PLACEHOLDER_TITLES.has(normalizeNoteTitle(b))) return 0;
	if (normalizedA === normalizeNoteTitle(b)) return 1;

	const tokensA = noteTitleTokens(a);
	const tokensB = noteTitleTokens(b);
	if (tokensA.size === 0 || tokensB.size === 0) return 0;

	const numbers = (tokens: Set<string>) =>
		[...tokens].filter((token) => /\d/.test(token)).sort().join(" ");
	if (numbers(tokensA) !== numbers(tokensB)) return 0;

	let shared = 0;
	for (const token of tokensA) if (tokensB.has(token)) shared += 1;
	return shared / (tokensA.size + tokensB.size - shared);
}

/**
 * The existing note a requested new-note title most likely duplicates, or
 * null. Deliberately conservative: appending into the wrong note is worse
 * than a near-duplicate, so only an identical normalized title or a word
 * overlap of at least 75% counts. Ties go to the earlier candidate, so pass
 * candidates most recently updated first.
 */
export function findMatchingNoteTitle<T extends { title: string }>(
	title: string,
	candidates: readonly T[]
): T | null {
	let best: T | null = null;
	let bestScore = 0;
	for (const candidate of candidates) {
		const score = noteTitleSimilarity(title, candidate.title);
		if (score >= TITLE_MATCH_MIN_JACCARD && score > bestScore) {
			best = candidate;
			bestScore = score;
			if (score === 1) break;
		}
	}
	return best;
}

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
	/**
	 * When creating a new titled note, first look for an existing note of this
	 * user with the same or a near-identical title and append there instead.
	 * The AI tool opts in: a retried or regenerated save otherwise leaves the
	 * same content in two differently titled notes.
	 */
	matchExistingTitle?: boolean;
	operation?: NoteAIWriteOperation;
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

	const requestedTitle = options.title?.trim();
	const written = await withNoteWrite(options.userId, options.operation, async (db) => {
		const linkDb = options.operation ? db : undefined;
		const matchedNote =
			!options.noteId && requestedTitle && options.matchExistingTitle
				? await findNoteMatchingTitle(options.userId, requestedTitle, db)
				: null;
		const targetNoteId = options.noteId || matchedNote?.id;

		if (targetNoteId) {
			const note = await db.note.findFirst({
				where: { id: targetNoteId, userId: options.userId },
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

			await db.note.update({
				where: { id: note.id },
				data: {
					htmlContent,
					plainText,
					content: htmlContent,
					wordCount: countWords(plainText),
				},
			});
			await syncNoteLinks({ userId: options.userId, noteId: note.id, plainText }, linkDb);

			return {
				result: {
					noteId: note.id,
					noteTitle: note.title,
					appendedHtml,
					created: false,
					matchedExisting: matchedNote !== null,
				},
				index: { userId: options.userId, noteId: note.id, title: note.title, plainText },
			};
		}

		const title = requestedTitle || "Note from SureWord";
		const note = await db.note.create({
			data: {
				userId: options.userId,
				title,
				content: appendedHtml,
				htmlContent: appendedHtml,
				plainText: appendedPlainText,
				wordCount: countWords(appendedPlainText),
			},
		});
		await syncNoteLinks({
			userId: options.userId,
			noteId: note.id,
			plainText: appendedPlainText,
		}, linkDb);
		await resolvePendingLinks({
			userId: options.userId,
			noteId: note.id,
			title,
			aliases: note.aliases,
		}, linkDb);

		return {
			result: {
				noteId: note.id,
				noteTitle: note.title,
				appendedHtml,
				created: true,
				matchedExisting: false,
			},
			index: { userId: options.userId, noteId: note.id, title, plainText: appendedPlainText },
		};
	});
	// Embedding generation does network I/O and must start after the fence commits.
	await syncNoteEmbeddings(written.index);
	return written.result;
}

/** The user's existing note whose title a new-note request duplicates, if any. */
async function findNoteMatchingTitle(
	userId: string,
	title: string,
	db: Prisma.TransactionClient
): Promise<{ id: string; title: string } | null> {
	const candidates = await db.note.findMany({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		take: TITLE_MATCH_CANDIDATE_LIMIT,
		select: { id: true, title: true },
	});
	return findMatchingNoteTitle(title, candidates);
}

export interface NoteContent {
	noteId: string;
	title: string;
	/** The note body as HTML (what the editor renders), capped for the model. */
	htmlContent: string;
	truncated: boolean;
	wordCount: number;
	tags: string[];
	/** Name of the folder the note is filed in, or null when unfiled. */
	folder: string | null;
	pinned: boolean;
	/** Extra names a [[wikilink]] may resolve to besides the title. */
	aliases: string[];
	/** Obsidian-style properties, or null when the note has none (or they are malformed). */
	properties: NoteProperties | null;
	updatedAt: string;
}

/**
 * Read a full note for the AI, including its body, so it can edit it
 * faithfully, and how it is organized (folder, tags, pin, aliases,
 * properties), so it can file it without guessing what is already there.
 */
export async function readUserNote(
	userId: string,
	noteId: string
): Promise<NoteContent> {
	const note = await prisma.note.findFirst({
		where: { id: noteId, userId },
		include: { tags: { include: { tag: true } }, folder: { select: { name: true } } },
	});
	if (!note) {
		throw new Error("Note not found.");
	}
	const html = note.htmlContent || note.plainText;
	// The column is free JSON; only a shape the editor itself would accept is
	// shown to the model, so a malformed row cannot masquerade as properties.
	const properties = validateProperties(note.properties ?? null);
	return {
		noteId: note.id,
		title: note.title,
		htmlContent: html.slice(0, MAX_READ_CONTENT_LENGTH),
		truncated: html.length > MAX_READ_CONTENT_LENGTH,
		wordCount: note.wordCount,
		tags: note.tags.map((noteTag) => noteTag.tag.name),
		folder: note.folder?.name ?? null,
		pinned: note.isPinned,
		aliases: note.aliases,
		properties: properties.ok ? properties.value : null,
		updatedAt: note.updatedAt.toISOString(),
	};
}

/**
 * A folderId that is not one of the caller's own folders. Routes answer 400:
 * the bad value is in the request body, and a 404 on a note PATCH would read
 * as "this note is gone".
 */
export class FolderNotFoundError extends Error {
	constructor() {
		super("Folder not found");
		this.name = "FolderNotFoundError";
	}
}

/**
 * Resolve a client-supplied folderId for a note write: undefined leaves the
 * folder alone, null or "" unfiles, and anything else must name a folder this
 * user owns. The (folderId, userId) foreign key refuses a foreign folder too;
 * checking first turns that into a clean 400 instead of a database error.
 */
export async function resolveOwnedFolderId(
	userId: string,
	folderId: unknown,
	db: Prisma.TransactionClient = prisma
): Promise<string | null | undefined> {
	if (folderId === undefined) return undefined;
	if (folderId === null || folderId === "") return null;
	if (typeof folderId !== "string") throw new FolderNotFoundError();
	const folder = await db.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
	if (!folder) throw new FolderNotFoundError();
	return folder.id;
}

/** Fields PATCH /api/notes/[id] may change, already validated by the caller. */
export interface NotePatch {
	title?: string;
	content?: string;
	htmlContent?: string;
	plainText?: string;
	aliases?: string[];
	properties?: NoteProperties | null;
	folderId?: string | null;
	isPinned?: boolean;
	wordCount?: number;
}

/**
 * Apply a note patch and keep links and the semantic index in step. Shared by
 * PATCH /api/notes/[id] and the organizeNote tool. Throws Prisma's P2025 when
 * the note does not exist or belongs to someone else, because the userId guard
 * lives in the update itself (extendedWhereUnique) instead of a separate read.
 */
export async function patchUserNote(
	userId: string,
	noteId: string,
	patch: NotePatch,
	options: {
		/**
		 * Hand the embedding sync to the platform instead of awaiting it; the
		 * route passes waitUntil so a slow sync never holds the response.
		 */
		deferEmbeddings?: (task: Promise<void>) => void;
		operation?: NoteAIWriteOperation;
	} = {}
) {
	const note = await withNoteWrite(userId, options.operation, (db) =>
		patchUserNoteWithClient(db, userId, noteId, patch, options.operation ? db : undefined)
	);
	// A failed sync only degrades AI note search, so it may run off the
	// response path when the caller allows it. Never start it inside the fence.
	if (patch.title !== undefined || patch.plainText !== undefined) {
		const sync = syncNoteEmbeddings({
			userId,
			noteId: note.id,
			title: note.title,
			plainText: note.plainText,
		});
		if (options.deferEmbeddings) options.deferEmbeddings(sync);
		else await sync;
	}
	return note;
}

/** Canonical patch + links only, so organize can use its already fenced client. */
async function patchUserNoteWithClient(
	db: Prisma.TransactionClient,
	userId: string,
	noteId: string,
	patch: NotePatch,
	linkDb?: Prisma.TransactionClient
) {
	const folderId = await resolveOwnedFolderId(userId, patch.folderId, db);
	const note = await db.note.update({
		where: { id: noteId, userId },
		data: {
			...(patch.title !== undefined && { title: patch.title }),
			...(patch.content !== undefined && { content: patch.content }),
			...(patch.htmlContent !== undefined && { htmlContent: patch.htmlContent }),
			...(patch.plainText !== undefined && { plainText: patch.plainText }),
			...(patch.aliases !== undefined && { aliases: patch.aliases }),
			...(patch.properties !== undefined && { properties: patch.properties ?? Prisma.DbNull }),
			...(folderId !== undefined && { folderId }),
			...(patch.isPinned !== undefined && { isPinned: patch.isPinned }),
			...(patch.wordCount !== undefined && { wordCount: patch.wordCount }),
		},
		include: { tags: { include: { tag: true } } },
	});
	// Always awaited: the editor re-reads links right after a save, so a
	// deferred sync would show the previous set.
	if (patch.plainText !== undefined) {
		await syncNoteLinks({ userId, noteId: note.id, plainText: note.plainText }, linkDb);
	}
	// A rename or a new alias can only resolve links, never unresolve them.
	if (patch.title !== undefined || patch.aliases !== undefined) {
		await resolvePendingLinks({
			userId,
			noteId: note.id,
			title: note.title,
			aliases: note.aliases,
		}, linkDb);
	}
	return note;
}

/** Same grey POST /api/tags gives a tag created without a colour. */
export const DEFAULT_TAG_COLOR = "#6b7280";
export const MAX_ORGANIZE_TAGS = 10;
export const MAX_ORGANIZE_NAME_LENGTH = 60;

export interface OrganizeNoteResult {
	success: true;
	noteId: string;
	/** The note's title after the change, for the "Filed {noteTitle}" receipt. */
	title: string;
	folder: string | null;
	tags: string[];
	pinned: boolean;
	/** True when folderName matched no folder and one was created. */
	createdFolder: boolean;
	/** Tag names that did not exist and were created. */
	createdTags: string[];
}

/**
 * File, tag, rename or pin one note for the assistant. A folder or tag is
 * matched to the user's existing ones by name, case-insensitively, and created
 * only when none matches, so "file it under romans" lands in "Romans". Tags are
 * added, never removed: the model rarely holds the full tag list, and dropping
 * a tag the user chose is worse than leaving one on.
 */
export async function organizeUserNote(options: {
	userId: string;
	noteId: string;
	title?: string;
	folderName?: string;
	tags?: readonly string[];
	pinned?: boolean;
	operation?: NoteAIWriteOperation;
}): Promise<OrganizeNoteResult> {
	const { userId, noteId } = options;
	// Models send empty strings for fields they mean to omit.
	const title = options.title?.trim().slice(0, 200) || undefined;
	const folderName = options.folderName?.trim().slice(0, MAX_ORGANIZE_NAME_LENGTH) || undefined;
	const tagNames: string[] = [];
	for (const raw of options.tags ?? []) {
		const name = raw.trim().replace(/^#/, "").slice(0, MAX_ORGANIZE_NAME_LENGTH);
		if (name && !tagNames.some((seen) => seen.toLowerCase() === name.toLowerCase())) tagNames.push(name);
	}
	if (tagNames.length > MAX_ORGANIZE_TAGS) tagNames.length = MAX_ORGANIZE_TAGS;
	if (!title && !folderName && tagNames.length === 0 && options.pinned === undefined) {
		throw new Error("Nothing to change: pass a title, folderName, tags, or pinned.");
	}

	const written = await withNoteWrite(userId, options.operation, async (db) => {
		const owned = await db.note.findFirst({ where: { id: noteId, userId }, select: { id: true } });
		if (!owned) {
			throw new Error("Note not found.");
		}

		let folderId: string | undefined;
		let createdFolder = false;
		if (folderName) {
			const folder = await db.folder.findFirst({
				where: { userId, name: { equals: folderName, mode: "insensitive" } },
				orderBy: { sortOrder: "asc" },
				select: { id: true },
			});
			if (folder) {
				folderId = folder.id;
			} else {
				// Appended last, the way POST /api/folders orders a new folder.
				const count = await db.folder.count({ where: { userId } });
				const created = await db.folder.create({
					data: { userId, name: folderName, sortOrder: count },
					select: { id: true },
				});
				folderId = created.id;
				createdFolder = true;
			}
		}

		const createdTags: string[] = [];
		if (tagNames.length > 0) {
			const existing = await db.tag.findMany({
				where: {
					userId,
					OR: tagNames.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })),
				},
				orderBy: { createdAt: "asc" },
				select: { id: true, name: true },
			});
			const idByName = new Map<string, string>();
			for (const tag of existing) {
				const key = tag.name.toLowerCase();
				if (!idByName.has(key)) idByName.set(key, tag.id);
			}
			const tagIds: string[] = [];
			for (const name of tagNames) {
				let tagId = idByName.get(name.toLowerCase());
				if (!tagId) {
					const created = await db.tag.create({
						data: { userId, name, color: DEFAULT_TAG_COLOR },
						select: { id: true },
					});
					tagId = created.id;
					createdTags.push(name);
				}
				tagIds.push(tagId);
			}
			await db.noteTag.createMany({
				data: tagIds.map((tagId) => ({ noteId, tagId })),
				skipDuplicates: true,
			});
		}

		const patch: NotePatch = {
			...(title !== undefined && { title }),
			...(folderId !== undefined && { folderId }),
			...(options.pinned !== undefined && { isPinned: options.pinned }),
		};
		let index: Parameters<typeof syncNoteEmbeddings>[0] | undefined;
		if (Object.keys(patch).length > 0) {
			const patched = await patchUserNoteWithClient(
				db, userId, noteId, patch, options.operation ? db : undefined
			);
			if (title !== undefined) {
				index = { userId, noteId, title: patched.title, plainText: patched.plainText };
			}
		}

		const note = await db.note.findFirst({
			where: { id: noteId, userId },
			select: {
				id: true,
				title: true,
				isPinned: true,
				folder: { select: { name: true } },
				tags: { select: { tag: { select: { name: true } } } },
			},
		});
		if (!note) {
			throw new Error("Note not found.");
		}
		return {
			result: {
				success: true as const,
				noteId: note.id,
				title: note.title,
				folder: note.folder?.name ?? null,
				tags: note.tags.map((noteTag) => noteTag.tag.name),
				pinned: note.isPinned,
				createdFolder,
				createdTags,
			},
			index,
		};
	});
	if (written.index) await syncNoteEmbeddings(written.index);
	return written.result;
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
	operation?: NoteAIWriteOperation;
}): Promise<RewriteNoteResult> {
	const markdown = options.markdown.slice(0, MAX_REWRITE_MARKDOWN_LENGTH);
	const htmlContent = markdownToNoteHtml(markdown);
	if (!htmlContent) {
		throw new Error("The rewritten content was empty; the note was left untouched.");
	}
	const plainText = htmlToPlainText(htmlContent);

	const written = await withNoteWrite(options.userId, options.operation, async (db) => {
		const linkDb = options.operation ? db : undefined;
		const note = await db.note.findFirst({
			where: { id: options.noteId, userId: options.userId },
			select: {
				id: true,
				title: true,
				aliases: true,
				wordCount: true,
				htmlContent: true,
				plainText: true,
			},
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
		await db.note.update({
			where: { id: note.id },
			data: {
				title,
				htmlContent,
				plainText,
				content: htmlContent,
				wordCount: countWords(plainText),
			},
		});
		await syncNoteLinks({ userId: options.userId, noteId: note.id, plainText }, linkDb);
		if (title !== note.title) {
			await resolvePendingLinks({
				userId: options.userId,
				noteId: note.id,
				title,
				aliases: note.aliases,
			}, linkDb);
		}

		return {
			result: {
				noteId: note.id,
				noteTitle: title,
				previousWordCount: note.wordCount,
				wordCount: countWords(plainText),
			},
			index: { userId: options.userId, noteId: note.id, title, plainText },
		};
	});
	await syncNoteEmbeddings(written.index);
	return written.result;
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

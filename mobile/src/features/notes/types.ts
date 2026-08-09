/** Notes domain types, ported from the web app (src/types/notes.ts). */

export interface Tag {
	id: string;
	name: string;
	color: string;
	createdAt: string;
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null;
	sortOrder: number;
	createdAt: string;
}

export interface Note {
	id: string;
	/**
	 * Tiptap JSON string when authored on the web, HTML when authored on
	 * mobile. Always read `htmlContent` for rendering/editing.
	 */
	content: string;
	htmlContent: string;
	title: string;
	plainText: string;
	folderId: string | null;
	tagIds: string[];
	createdAt: string;
	updatedAt: string;
	isPinned: boolean;
	wordCount: number;
}

/** Raw note row as returned by /api/notes (tags come through a join table). */
export interface NoteApiResponse {
	id: string;
	title: string;
	content: string;
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	isPinned: boolean;
	wordCount: number;
	createdAt: string;
	updatedAt: string;
	tags?: { tag: Tag }[];
}

export type NotePatch = Partial<{
	title: string;
	content: string;
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	isPinned: boolean;
	wordCount: number;
}>;

/** What the rich text editor hands back on every autosave. */
export interface NoteSavePayload {
	content: string;
	htmlContent: string;
	plainText: string;
	wordCount: number;
}

export function toNote(api: NoteApiResponse): Note {
	return {
		id: api.id,
		title: api.title,
		content: api.content,
		htmlContent: api.htmlContent,
		plainText: api.plainText,
		folderId: api.folderId,
		tagIds: (api.tags ?? []).map((entry) => entry.tag.id),
		createdAt: api.createdAt,
		updatedAt: api.updatedAt,
		isPinned: api.isPinned,
		wordCount: api.wordCount,
	};
}

/** Same eight swatches the web TagManager offers. */
export const PRESET_TAG_COLORS = [
	"#f59e0b",
	"#ef4444",
	"#22c55e",
	"#3b82f6",
	"#a855f7",
	"#ec4899",
	"#06b6d4",
	"#f97316",
] as const;

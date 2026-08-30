/** Value of a user-defined note property (Obsidian-style frontmatter). */
export type NotePropertyValue = string | number | boolean | string[];

export type NoteProperties = Record<string, NotePropertyValue>;

export type NotePropertyKind = "text" | "number" | "checkbox" | "list";

export interface Note {
	id: string;
	title: string;
	content: string; // Tiptap JSON string
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	tagIds: string[]; // derived from tags join table
	aliases: string[]; // alternate titles that [[wikilinks]] may resolve to
	properties: NoteProperties | null;
	createdAt: string; // ISO date string
	updatedAt: string; // ISO date string
	isPinned: boolean;
	wordCount: number;
}

/** One `[[Target]]` reference found in this note's text. */
export interface NoteOutgoingLink {
	targetTitle: string;
	noteId: string | null; // null when no note matches the target yet
	title: string | null;
}

/** Another note that links to this one. */
export interface NoteBacklink {
	noteId: string;
	title: string;
	snippet: string;
	updatedAt: string;
}

export interface NoteLinks {
	outgoing: NoteOutgoingLink[];
	backlinks: NoteBacklink[];
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null;
	sortOrder: number;
	createdAt: string; // ISO date string
}

export interface Tag {
	id: string;
	name: string;
	color: string;
	createdAt: string; // ISO date string
}

export interface NoteAIMessage {
	id: string;
	noteId: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string; // ISO date string
	isStreaming?: boolean;
}

/** Raw API response for a note (includes join table shape) */
export interface NoteApiResponse {
	id: string;
	title: string;
	content: string;
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	userId: string;
	isPinned: boolean;
	wordCount: number;
	createdAt: string;
	updatedAt: string;
	tags: { tag: Tag }[];
	// Optional so a client built ahead of the server deploy still parses rows.
	aliases?: string[] | null;
	properties?: NoteProperties | null;
}

/** Transform API note response to client Note shape */
export function toNote(apiNote: NoteApiResponse): Note {
	return {
		id: apiNote.id,
		title: apiNote.title,
		content: apiNote.content,
		htmlContent: apiNote.htmlContent,
		plainText: apiNote.plainText,
		folderId: apiNote.folderId,
		tagIds: apiNote.tags.map((t) => t.tag.id),
		aliases: apiNote.aliases ?? [],
		properties: apiNote.properties ?? null,
		createdAt: apiNote.createdAt,
		updatedAt: apiNote.updatedAt,
		isPinned: apiNote.isPinned,
		wordCount: apiNote.wordCount,
	};
}

/** Build the wikilink text inserted into a note body. */
export function formatWikilink(title: string): string {
	return `[[${title.trim()}]]`;
}

/** Best-effort kind for an existing property value, used to pick an editor. */
export function propertyKindOf(value: NotePropertyValue): NotePropertyKind {
	if (typeof value === "boolean") return "checkbox";
	if (typeof value === "number") return "number";
	if (Array.isArray(value)) return "list";
	return "text";
}

export function emptyPropertyValue(kind: NotePropertyKind): NotePropertyValue {
	switch (kind) {
		case "number":
			return 0;
		case "checkbox":
			return false;
		case "list":
			return [];
		default:
			return "";
	}
}

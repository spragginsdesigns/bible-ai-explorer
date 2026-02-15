export interface Note {
	id: string;
	title: string;
	content: string; // Tiptap JSON string
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	tagIds: string[]; // derived from tags join table
	createdAt: string; // ISO date string
	updatedAt: string; // ISO date string
	isPinned: boolean;
	wordCount: number;
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
		createdAt: apiNote.createdAt,
		updatedAt: apiNote.updatedAt,
		isPinned: apiNote.isPinned,
		wordCount: apiNote.wordCount,
	};
}

export interface Note {
	id: string;
	title: string;
	content: string; // Tiptap JSON string
	htmlContent: string;
	plainText: string;
	folderId: string | null;
	tagIds: string[];
	createdAt: number;
	updatedAt: number;
	isPinned: boolean;
	wordCount: number;
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null;
	sortOrder: number;
	createdAt: number;
}

export interface Tag {
	id: string;
	name: string;
	color: string;
	createdAt: number;
}

export interface NoteAIMessage {
	id: string;
	noteId: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	isStreaming?: boolean;
}

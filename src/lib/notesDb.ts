import Dexie, { type Table } from "dexie";
import type { Note, Folder, Tag, NoteAIMessage } from "@/types/notes";

class NotesDatabase extends Dexie {
	notes!: Table<Note>;
	folders!: Table<Folder>;
	tags!: Table<Tag>;
	noteAIMessages!: Table<NoteAIMessage>;

	constructor() {
		super("versemind-notes");
		this.version(1).stores({
			notes: "id, folderId, updatedAt, isPinned, *tagIds",
			folders: "id, parentId, sortOrder",
			tags: "id, name",
			noteAIMessages: "id, noteId, timestamp",
		});
	}
}

export const notesDb = new NotesDatabase();

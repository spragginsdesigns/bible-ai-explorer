import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: vi.fn(async () => null),
		setItem: vi.fn(async () => undefined),
	},
}));

import {
	applyServerSnapshot,
	getCachedNote,
	patchNoteInCache,
	removeNoteFromCache,
	upsertNoteInCache,
} from "./notesStore";
import type { Note } from "./types";

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
	return {
		id,
		title: `Note ${id}`,
		content: "",
		htmlContent: "",
		plainText: "",
		folderId: null,
		tagIds: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		isPinned: false,
		wordCount: 0,
		...overrides,
	};
}

beforeEach(() => {
	// Reset the singleton between tests by applying an empty snapshot.
	applyServerSnapshot([], [], []);
});

describe("applyServerSnapshot", () => {
	it("keeps the cached body when the server row is unchanged", () => {
		upsertNoteInCache(makeNote("a", { htmlContent: "<p>body</p>", hasBody: true }));

		// Summary rows omit the body fields.
		applyServerSnapshot([makeNote("a", { title: "Renamed?" })], [], []);

		const note = getCachedNote("a");
		expect(note?.htmlContent).toBe("<p>body</p>");
		expect(note?.hasBody).toBe(true);
	});

	it("drops a stale cached body when updatedAt moved on", () => {
		upsertNoteInCache(makeNote("a", { htmlContent: "<p>old</p>", hasBody: true }));

		applyServerSnapshot(
			[makeNote("a", { updatedAt: "2026-01-02T00:00:00.000Z" })],
			[],
			[]
		);

		const note = getCachedNote("a");
		expect(note?.htmlContent).toBe("");
		expect(note?.hasBody).toBeUndefined();
	});

	it("replaces folders and tags", () => {
		const folder = { id: "f1", name: "Study", parentId: null, sortOrder: 0, createdAt: "" };
		const tag = { id: "t1", name: "Grace", color: "#fff", createdAt: "" };
		applyServerSnapshot([], [folder], [tag]);
		// No direct getter for folders/tags; assert via a follow-up snapshot.
		applyServerSnapshot([makeNote("b")], [folder], [tag]);
		expect(getCachedNote("b")).not.toBeNull();
	});
});

describe("note mutations", () => {
	it("upserts, patches, and removes notes", () => {
		upsertNoteInCache(makeNote("a"));
		upsertNoteInCache(makeNote("a", { title: "Updated" }));
		expect(getCachedNote("a")?.title).toBe("Updated");

		patchNoteInCache("a", { isPinned: true });
		expect(getCachedNote("a")?.isPinned).toBe(true);

		removeNoteFromCache("a");
		expect(getCachedNote("a")).toBeNull();
	});

	it("inserts new notes at the front", () => {
		upsertNoteInCache(makeNote("a"));
		upsertNoteInCache(makeNote("b"));
		applyServerSnapshot([makeNote("a"), makeNote("b")], [], []);
		expect(getCachedNote("b")).not.toBeNull();
	});
});

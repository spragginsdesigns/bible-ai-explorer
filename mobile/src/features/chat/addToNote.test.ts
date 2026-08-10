import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteApiResponse } from "@/features/notes/types";

// apiJson pulls in expo-constants/expo-fetch; the tests only need its call shape.
vi.mock("@/lib/api", () => ({
	apiJson: vi.fn(),
}));

import { apiJson } from "@/lib/api";
import { appendAnswerToNote, filterNotesByQuery } from "./addToNote";

const getToken = async () => "token";

function note(partial: Partial<NoteApiResponse>): NoteApiResponse {
	return {
		id: "n1",
		title: "Romans study",
		plainText: "Justification by faith alone",
		folderId: null,
		isPinned: false,
		wordCount: 5,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-09T00:00:00.000Z",
		...partial,
	};
}

beforeEach(() => vi.clearAllMocks());

describe("filterNotesByQuery", () => {
	const notes = [
		note({ id: "a", title: "Romans study", plainText: "Justification by faith" }),
		note({ id: "b", title: "Prayer list", plainText: "For the elders" }),
	];

	it("returns every note for a blank query", () => {
		expect(filterNotesByQuery(notes, "")).toEqual(notes);
		expect(filterNotesByQuery(notes, "   ")).toEqual(notes);
	});

	it("matches on title, case-insensitively", () => {
		expect(filterNotesByQuery(notes, "romans").map((n) => n.id)).toEqual(["a"]);
	});

	it("matches on the body preview", () => {
		expect(filterNotesByQuery(notes, "elders").map((n) => n.id)).toEqual(["b"]);
	});

	it("returns nothing when no note matches", () => {
		expect(filterNotesByQuery(notes, "genesis")).toEqual([]);
	});
});

describe("appendAnswerToNote", () => {
	it("posts the append body to the append endpoint", async () => {
		vi.mocked(apiJson).mockResolvedValue({ noteId: "n1", noteTitle: "T", created: false });

		const result = await appendAnswerToNote(getToken, { markdown: "**Answer**", noteId: "n1" });

		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/notes/append", {
			method: "POST",
			body: { markdown: "**Answer**", noteId: "n1" },
		});
		expect(result).toEqual({ noteId: "n1", noteTitle: "T", created: false });
	});

	it("sends noteId null plus title when creating", async () => {
		vi.mocked(apiJson).mockResolvedValue({ noteId: "n2", noteTitle: "New", created: true });

		await appendAnswerToNote(getToken, {
			markdown: "text",
			noteId: null,
			title: "Romans 8",
		});

		expect(apiJson).toHaveBeenCalledWith(getToken, "/api/notes/append", {
			method: "POST",
			body: { markdown: "text", noteId: null, title: "Romans 8" },
		});
	});
});

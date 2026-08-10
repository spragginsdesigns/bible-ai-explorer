import { beforeEach, describe, expect, it, vi } from "vitest";

// Native modules are mocked: these tests exercise pure formatting and the
// create→patch note flow, not the device clipboard/share sheet.
vi.mock("react-native", () => ({
	Share: { share: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("expo-clipboard", () => ({
	setStringAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/notes/api", () => ({
	createNote: vi.fn(),
	patchNote: vi.fn(),
}));

import { createNote, patchNote } from "@/features/notes/api";
import { formatVerseForSharing, saveVerseToNote } from "./verseActions";

const getToken = async () => "token";

beforeEach(() => vi.clearAllMocks());

describe("formatVerseForSharing", () => {
	it("formats reference and text as a quotation", () => {
		expect(
			formatVerseForSharing({ reference: "John 3:16", text: "For God so loved the world…" })
		).toBe('John 3:16 — "For God so loved the world…" (KJV)');
	});

	it("handles a missing text", () => {
		expect(formatVerseForSharing({ reference: "Psalm 23:1" })).toBe("Psalm 23:1 (KJV)");
	});
});

describe("saveVerseToNote", () => {
	it("creates a note titled by the reference, then patches Scripture HTML in", async () => {
		vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);
		vi.mocked(patchNote).mockResolvedValue({} as never);

		const id = await saveVerseToNote(getToken, {
			reference: "John 3:16",
			text: "For God so loved the world…",
		});

		expect(id).toBe("note-1");
		expect(createNote).toHaveBeenCalledWith(getToken, { title: "John 3:16", folderId: null });

		const [, noteId, patch] = vi.mocked(patchNote).mock.calls[0] as unknown as [
			unknown,
			string,
			{ htmlContent: string; plainText: string; wordCount: number },
		];
		expect(noteId).toBe("note-1");
		expect(patch.htmlContent).toContain("<blockquote>");
		expect(patch.htmlContent).toContain("<strong>John 3:16</strong>");
		expect(patch.htmlContent).toContain("For God so loved the world…");
		expect(patch.plainText).toContain("John 3:16");
		expect(patch.wordCount).toBeGreaterThan(0);
	});

	it("escapes HTML in verse text", async () => {
		vi.mocked(createNote).mockResolvedValue({ id: "note-2" } as never);
		vi.mocked(patchNote).mockResolvedValue({} as never);

		await saveVerseToNote(getToken, { reference: "Test 1:1", text: 'a <b> & "c"' });

		const [, , patch] = vi.mocked(patchNote).mock.calls[0] as unknown as [
			unknown,
			string,
			{ htmlContent: string },
		];
		expect(patch.htmlContent).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
		expect(patch.htmlContent).not.toContain("<b>");
	});
});

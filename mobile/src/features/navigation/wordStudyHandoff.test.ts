import { describe, expect, it } from "vitest";
import { wordStudyHandoff } from "./wordStudyHandoff";

describe("word study to chat", () => {
	it("pins actual bundled Scripture with its reference and translation", () => {
		const result = wordStudyHandoff({ order: 43, chapter: 1, verse: 1 }, "What does Word mean here?", true, "1");
		expect(result).toMatchObject({ attachRef: "John 1:1", attachText: "In the beginning was the Word, and the Word was with God, and the Word was God.", attachTranslation: "KJV", clearAttachment: "0", verseOfDayId: "" });
	});
	it("clears the previous passage for a whole-Bible question", () => {
		expect(wordStudyHandoff({ order: 43, chapter: 1, verse: 1 }, "Find this word", false, "2")).toMatchObject({ clearAttachment: "1", attachRef: "", attachText: "", attachTranslation: "", handoffId: "2", verseOfDayId: "" });
	});
	it("refuses to create an empty attachment for a nonexistent verse", () => {
		expect(wordStudyHandoff({ order: 43, chapter: 1, verse: 176 }, "Explain", true, "3")).toBeNull();
	});
});

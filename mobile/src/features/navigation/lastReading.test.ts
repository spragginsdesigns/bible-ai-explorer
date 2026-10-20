import { describe, expect, it } from "vitest";
import { parseLastRead } from "./lastReading";

const reading = { book: "John", chapter: 15, translation: "KJV", readAt: "2026-10-19T12:00:00Z" };
describe("continue reading", () => {
	it("keeps the real passage and its translation", () => {
		expect(parseLastRead(reading)).toEqual(reading);
	});
	it.each([null, {}, { ...reading, chapter: 0 }, { ...reading, chapter: 22 }, { ...reading, chapter: 3.5 }, { ...reading, book: "Imaginary" }, { ...reading, translation: "unknown" }, { ...reading, readAt: "yesterday" }])("does not invent a passage for invalid history %j", (value) => {
		expect(parseLastRead(value)).toBeNull();
	});
});

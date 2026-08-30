import { describe, expect, it } from "vitest";
import {
	formatPropertyValue,
	normalizeAliases,
	normalizePropertyKey,
	parsePropertyValue,
	propertyEntries,
	propertyKeyTaken,
	propertyTypeOf,
	propertyValueToInput,
	removeNoteProperty,
	setNoteProperty,
} from "./noteProperties";

describe("propertyTypeOf", () => {
	it("maps each stored shape back to its editor type", () => {
		expect(propertyTypeOf("Paul")).toBe("text");
		expect(propertyTypeOf(3)).toBe("number");
		expect(propertyTypeOf(true)).toBe("checkbox");
		expect(propertyTypeOf(["a", "b"])).toBe("list");
	});
});

describe("parsePropertyValue", () => {
	it("rejects input that cannot make a valid value", () => {
		expect(parsePropertyValue("number", "not a number")).toBeNull();
		expect(parsePropertyValue("number", "  ")).toBeNull();
		expect(parsePropertyValue("text", "   ")).toBeNull();
		expect(parsePropertyValue("list", " , , ")).toBeNull();
		expect(parsePropertyValue("checkbox", "maybe")).toBeNull();
	});

	it("parses each type", () => {
		expect(parsePropertyValue("text", "  Romans  ")).toBe("Romans");
		expect(parsePropertyValue("number", " -2.5 ")).toBe(-2.5);
		expect(parsePropertyValue("checkbox", "TRUE")).toBe(true);
		expect(parsePropertyValue("checkbox", "false")).toBe(false);
		expect(parsePropertyValue("list", "a, b ,, c")).toEqual(["a", "b", "c"]);
	});

	it("does not accept Infinity as a number", () => {
		expect(parsePropertyValue("number", "Infinity")).toBeNull();
	});
});

describe("value rendering", () => {
	it("formats for display and round-trips into the input", () => {
		expect(formatPropertyValue(true)).toBe("Yes");
		expect(formatPropertyValue(["a", "b"])).toBe("a, b");
		expect(propertyValueToInput(false)).toBe("false");
		expect(propertyValueToInput(["a", "b"])).toBe("a, b");
	});
});

describe("key handling", () => {
	it("normalizes whitespace", () => {
		expect(normalizePropertyKey("  read   by  ")).toBe("read by");
	});

	it("detects collisions case-insensitively but skips the row being edited", () => {
		const props = { Author: "Paul" };
		expect(propertyKeyTaken(props, "author")).toBe(true);
		expect(propertyKeyTaken(props, "author", "Author")).toBe(false);
		expect(propertyKeyTaken(props, "  ")).toBe(false);
		expect(propertyKeyTaken(null, "author")).toBe(false);
	});
});

describe("property mutations", () => {
	it("sorts entries so rows stay put", () => {
		expect(propertyEntries({ zeal: 1, author: "Paul" })).toEqual([
			["author", "Paul"],
			["zeal", 1],
		]);
	});

	it("drops the old key when a property is renamed", () => {
		expect(setNoteProperty({ author: "Paul" }, "writer", "Paul", "author")).toEqual({
			writer: "Paul",
		});
	});

	it("adds without touching the original object", () => {
		const props = { author: "Paul" };
		expect(setNoteProperty(props, "book", "Romans")).toEqual({
			author: "Paul",
			book: "Romans",
		});
		expect(props).toEqual({ author: "Paul" });
	});

	it("removes a key", () => {
		expect(removeNoteProperty({ author: "Paul", book: "Romans" }, "author")).toEqual({
			book: "Romans",
		});
	});
});

describe("normalizeAliases", () => {
	it("trims, drops blanks, and keeps the first spelling of a duplicate", () => {
		expect(normalizeAliases([" Paul to Rome ", "", "paul to rome", "Romans"])).toEqual([
			"Paul to Rome",
			"Romans",
		]);
	});
});

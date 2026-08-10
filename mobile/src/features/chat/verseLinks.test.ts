import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
	openReferenceInReader,
	resolveVerseReference,
	segmentVerseReferences,
	VERSE_REF_SCHEME,
	verseReferencePlugin,
} from "./verseLinks";

describe("resolveVerseReference", () => {
	it("resolves a plain reference", () => {
		expect(resolveVerseReference("John 3:16")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("resolves a range to its start verse (en dash)", () => {
		expect(resolveVerseReference("1 John 5:1–4")).toEqual({ order: 62, chapter: 5, verse: 1 });
	});

	it("resolves a range to its start verse (hyphen)", () => {
		expect(resolveVerseReference("John 3:16-18")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("resolves Psalm alias and numbered/abbreviated books", () => {
		expect(resolveVerseReference("Psalm 23:1")).toEqual({ order: 19, chapter: 23, verse: 1 });
		expect(resolveVerseReference("Titus 3:5")).toEqual({ order: 56, chapter: 3, verse: 5 });
		expect(resolveVerseReference("2 Tim. 4:7")).toEqual({ order: 55, chapter: 4, verse: 7 });
	});

	it("strips a trailing translation tag", () => {
		expect(resolveVerseReference("John 3:16 KJV")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("returns null for unparseable or out-of-range input", () => {
		expect(resolveVerseReference("John 99:16")).toBeNull();
		expect(resolveVerseReference("Notabook 3:16")).toBeNull();
		expect(resolveVerseReference("hello world")).toBeNull();
	});
});

describe("segmentVerseReferences", () => {
	it("detects a single reference", () => {
		expect(segmentVerseReferences("John 3:16")).toEqual([{ type: "verse-ref", value: "John 3:16" }]);
	});

	it("detects ranges with en dash and hyphen", () => {
		expect(segmentVerseReferences("1 John 5:1–4")).toEqual([
			{ type: "verse-ref", value: "1 John 5:1–4" },
		]);
		expect(segmentVerseReferences("John 3:16-18")).toEqual([
			{ type: "verse-ref", value: "John 3:16-18" },
		]);
	});

	it("keeps the trailing translation tag in the link text", () => {
		expect(segmentVerseReferences("John 3:16 KJV")).toEqual([
			{ type: "verse-ref", value: "John 3:16 KJV" },
		]);
	});

	it("finds multiple references in one string", () => {
		expect(segmentVerseReferences("See John 3:16 and Romans 5:8 for more.")).toEqual([
			{ type: "text", value: "See " },
			{ type: "verse-ref", value: "John 3:16" },
			{ type: "text", value: " and " },
			{ type: "verse-ref", value: "Romans 5:8" },
			{ type: "text", value: " for more." },
		]);
	});

	it("detects references inside quoted Scripture", () => {
		const segments = segmentVerseReferences("“For God so loved the world” — John 3:16");
		expect(segments).toContainEqual({ type: "verse-ref", value: "John 3:16" });
	});

	it("produces no link for non-references", () => {
		expect(segmentVerseReferences("version 3:16 of the app")).toEqual([
			{ type: "text", value: "version 3:16 of the app" },
		]);
		expect(segmentVerseReferences("the quick brown fox jumps over")).toEqual([
			{ type: "text", value: "the quick brown fox jumps over" },
		]);
	});

	it("leaves unresolvable references as plain text", () => {
		expect(segmentVerseReferences("see John 99:16 sometime")).toEqual([
			{ type: "text", value: "see John 99:16 sometime" },
		]);
	});
});

describe("openReferenceInReader", () => {
	const makeRouter = () => {
		const calls: unknown[] = [];
		return { calls, push: (href: unknown) => calls.push(href) };
	};

	it("pushes the reader route with book, chapter and verse", () => {
		const router = makeRouter();
		openReferenceInReader(router, "John 3:16");
		expect(router.calls).toEqual([
			{ pathname: "/bible/chapter", params: { book: "43", chapter: "3", verse: "16" } },
		]);
	});

	it("pushes the start verse of a range", () => {
		const router = makeRouter();
		openReferenceInReader(router, "1 John 5:1–4");
		expect(router.calls).toEqual([
			{ pathname: "/bible/chapter", params: { book: "62", chapter: "5", verse: "1" } },
		]);
	});

	it("does nothing for unresolvable input", () => {
		const router = makeRouter();
		openReferenceInReader(router, "John 99:16");
		openReferenceInReader(router, "total nonsense");
		expect(router.calls).toEqual([]);
	});
});

describe("markdown-it integration (same setup as MarkdownBody)", () => {
	interface RealToken {
		type: string;
		attrs: [string, string][] | null;
		children?: RealToken[];
	}

	function hrefsOf(markdown: string): string[] {
		const md = new MarkdownIt({ typographer: true, linkify: true });
		md.use(verseReferencePlugin);
		const tokens: RealToken[] = md.parse(markdown, {});
		const hrefs: string[] = [];
		const walk = (list: RealToken[]) => {
			for (const token of list) {
				if (token.type === "link_open" && token.attrs) {
					const href = token.attrs.find(([name]) => name === "href");
					if (href) hrefs.push(href[1]);
				}
				if (token.children) walk(token.children);
			}
		};
		walk(tokens);
		return hrefs;
	}

	it("emits link_open/text/link_close triples, prose preserved around them", () => {
		const md = new MarkdownIt({ typographer: true, linkify: true });
		md.use(verseReferencePlugin);
		const inline = md
			.parse("read John 3:16 today", {})
			.find((token: { type: string }) => token.type === "inline");
		expect(
			inline.children.map((token: { type: string; content: string }) => [token.type, token.content])
		).toEqual([
			["text", "read "],
			["link_open", ""],
			["text", "John 3:16"],
			["link_close", ""],
			["text", " today"],
		]);
	});

	it("links references inside Scripture blockquotes and strong text", () => {
		expect(hrefsOf("> For God so loved the world — **John 3:16**")).toEqual([
			`${VERSE_REF_SCHEME}John 3:16`,
		]);
	});

	it("links several references across a chat-style reply", () => {
		expect(hrefsOf("Paul quotes Psalm 23:1, then Titus 3:5 and 1 John 5:1–4.")).toEqual([
			`${VERSE_REF_SCHEME}Psalm 23:1`,
			`${VERSE_REF_SCHEME}Titus 3:5`,
			`${VERSE_REF_SCHEME}1 John 5:1–4`,
		]);
	});

	it("keeps ordinary markdown links working alongside references", () => {
		expect(hrefsOf("See John 3:16 on [this site](https://example.com).")).toEqual([
			`${VERSE_REF_SCHEME}John 3:16`,
			"https://example.com",
		]);
	});

	it("does not linkify references inside code spans or link labels", () => {
		expect(hrefsOf("`John 3:16` and [John 3:16](https://example.com)")).toEqual([
			"https://example.com",
		]);
	});

	it("leaves unparseable lookalikes as plain text", () => {
		expect(hrefsOf("version 3:16 and John 99:16 are not links")).toEqual([]);
	});
});

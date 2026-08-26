import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
	ABBREVIATION_ALIASES,
	openReferenceInReader,
	resolveVerseReference,
	segmentVerseReferences,
	VERSE_REF_SCHEME,
	VERSE_REFERENCE_REGEX,
	verseReferencePlugin,
} from "./verseLinks";

/** Built from code points, not pasted: this toolchain mangles literal dashes. */
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/** Just the linked references, in order. */
const refsIn = (text: string): string[] =>
	segmentVerseReferences(text)
		.filter((segment) => segment.type === "verse-ref")
		.map((segment) => segment.value);

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

describe("C4 cross-chapter ranges and abbreviation forms", () => {
	it("captures a cross-chapter range whole, never truncated", () => {
		// Used to yield "John 3:16-4", leaving a dangling ":2" beside the link.
		expect(refsIn("Read John 3:16-4:2 for the full discourse.")).toEqual(["John 3:16-4:2"]);
		expect(resolveVerseReference("John 3:16-4:2")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("never captures a partial reference", () => {
		for (const value of refsIn("Read John 3:16-4:2 now")) {
			expect(value.endsWith(":")).toBe(false);
			expect(/\d:\d+$/.test(value) || /\d$/.test(value)).toBe(true);
		}
		// A chapter:verse whose verse runs past three digits is left alone entirely.
		expect(refsIn("John 3:1234")).toEqual([]);
	});

	it("accepts an em-dashed range", () => {
		expect(refsIn(`Deuteronomy 6:4${EM_DASH}5 is the Shema.`)).toEqual([
			`Deuteronomy 6:4${EM_DASH}5`,
		]);
		expect(resolveVerseReference(`Deuteronomy 6:4${EM_DASH}5`)).toEqual({
			order: 5,
			chapter: 6,
			verse: 4,
		});
	});

	it("links an abbreviation with no space after its period", () => {
		expect(refsIn("Gen.1:1 and Rev.22:21 and 2 Pet.1:19 and Rom.8:28")).toEqual([
			"Gen.1:1",
			"Rev.22:21",
			"2 Pet.1:19",
			"Rom.8:28",
		]);
		expect(resolveVerseReference("Gen.1:1")).toEqual({ order: 1, chapter: 1, verse: 1 });
		expect(resolveVerseReference("2 Pet.1:19")).toEqual({ order: 61, chapter: 1, verse: 19 });
	});

	it("links a periodless abbreviation", () => {
		expect(refsIn("Jn 3:16 says it plainly.")).toEqual(["Jn 3:16"]);
		expect(resolveVerseReference("Jn 3:16")).toEqual({ order: 43, chapter: 3, verse: 16 });
		expect(resolveVerseReference("Mk 1:1")).toEqual({ order: 41, chapter: 1, verse: 1 });
		expect(resolveVerseReference("Ps 23:1")).toEqual({ order: 19, chapter: 23, verse: 1 });
	});

	it("links the space-less numeral form the web parser has always taken", () => {
		expect(refsIn("as 1Cor 2:14 puts it")).toEqual(["1Cor 2:14"]);
		expect(resolveVerseReference("1Cor 2:14")).toEqual({ order: 46, chapter: 2, verse: 14 });
		expect(refsIn("as 1Thess 1:1 opens")).toEqual(["1Thess 1:1"]);
		expect(resolveVerseReference("1Thess 1:1")).toEqual({ order: 52, chapter: 1, verse: 1 });
		expect(refsIn("2Pet.1:19 shines in a dark place")).toEqual(["2Pet.1:19"]);
		// The alias expansion has to put the space back too, or "1Jn" becomes
		// "1John" and the book table, keyed on the spaced form, misses it.
		expect(resolveVerseReference("1Jn 5:1")).toEqual({ order: 62, chapter: 5, verse: 1 });
		// A numeral in front of a single-volume book still names nothing.
		expect(refsIn("see 1Isaiah 5:3 there")).toEqual([]);
	});

	it("links Song of Songs", () => {
		expect(refsIn("Song of Songs 2:1")).toEqual(["Song of Songs 2:1"]);
		expect(resolveVerseReference("Song of Songs 2:1")).toEqual({
			order: 22,
			chapter: 2,
			verse: 1,
		});
	});

	it("keeps the 37-input regression sweep resolving to the same books", () => {
		const sweep: [string, number][] = [
			["John 3:16", 43],
			["1 John 3:16", 62],
			["3 John 1:4", 64],
			["Psalm 23:1-6", 19],
			["Gen. 1:1-3", 1],
			["1 Cor. 2:14", 46],
			["Judges 6:12", 7],
			["Jude 1:3", 65],
			["Philemon 1:6", 57],
			["Philippians 4:13", 50],
			["2 Tim. 4:7", 55],
			["Titus 3:5", 56],
			[`1 John 5:1${EN_DASH}4`, 62],
		];
		for (const [input, order] of sweep) {
			expect(refsIn(input)).toEqual([input]);
			expect(resolveVerseReference(input)?.order).toBe(order);
		}
	});

	it("still links a reference that introduces a quote with a colon", () => {
		// From the production corpus: the range boundary must not reject a plain
		// trailing colon, only one that starts another number.
		expect(refsIn("can be found in John 3:14: \n\n> And as Moses lifted up")).toEqual([
			"John 3:14",
		]);
	});

	it("still leaves a bare time of day unlinked", () => {
		expect(refsIn("the meeting is at 3:16 John said")).toEqual([]);
		expect(refsIn("version 3:16 of the app")).toEqual([]);
	});
});

describe("abbreviation aliases are shared with the web client", () => {
	it("maps every stem books.json does not carry", () => {
		// src/utils/verseParser.ts mirrors these stems; the two must move together.
		expect(ABBREVIATION_ALIASES).toEqual({
			exod: "Exodus",
			eccles: "Ecclesiastes",
			ob: "Obadiah",
			mk: "Mark",
			lk: "Luke",
			jn: "John",
			tit: "Titus",
		});
	});

	it("resolves every alias to a real book", () => {
		for (const stem of Object.keys(ABBREVIATION_ALIASES)) {
			expect(resolveVerseReference(`${stem} 1:1`)).not.toBeNull();
		}
	});
});

describe("B7 the detection regex is compiled once", () => {
	it("allocates no RegExp per call", () => {
		const original = globalThis.RegExp;
		let constructed = 0;
		globalThis.RegExp = new Proxy(original, {
			construct(target, args) {
				constructed += 1;
				return Reflect.construct(target, args) as RegExp;
			},
		});
		try {
			segmentVerseReferences("See John 3:16 and Romans 5:8 for more.");
		} finally {
			globalThis.RegExp = original;
		}
		expect(constructed).toBe(0);
	});

	it("does not leak lastIndex between scans", () => {
		const first = refsIn("See John 3:16 now");
		const second = refsIn("See John 3:16 now");
		expect(second).toEqual(first);
		expect(VERSE_REFERENCE_REGEX.lastIndex).toBe(0);
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

	it("B4: leaves headings alone, so half a heading is not amber and underlined", () => {
		expect(hrefsOf("## 2 Peter 1:19 in the NKJV")).toEqual([]);
		expect(hrefsOf("# John 3:16")).toEqual([]);
		expect(hrefsOf("###### John 3:16")).toEqual([]);
	});

	it("B4: leaves table headers alone but still links body cells", () => {
		expect(hrefsOf("| John 3:16 | Note |\n| --- | --- |\n| Romans 5:8 | love |")).toEqual([
			`${VERSE_REF_SCHEME}Romans 5:8`,
		]);
	});

	it("B4: a reference in a table DATA cell stays tappable, by decision", () => {
		// Only the header row is skipped, and only because the link style would
		// turn half a heading amber and underlined. A data cell is ordinary body
		// text: a reference cited there should navigate like any other.
		const table = [
			"| Passage | Theme |",
			"| --- | --- |",
			"| John 3:16 | love |",
			"| Romans 5:8 | grace |",
		].join("\n");
		expect(hrefsOf(table)).toEqual([
			`${VERSE_REF_SCHEME}John 3:16`,
			`${VERSE_REF_SCHEME}Romans 5:8`,
		]);
	});

	it("B4: a header cell that is only a reference produces no link at all", () => {
		expect(hrefsOf("| John 3:16 |\n| --- |\n| plain |")).toEqual([]);
	});

	it("B4: resumes linking in the paragraph after a heading", () => {
		expect(hrefsOf("## John 3:16\n\nSee John 3:16 again.")).toEqual([
			`${VERSE_REF_SCHEME}John 3:16`,
		]);
	});
});

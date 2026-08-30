/**
 * Renderer-configuration tests for the Android markdown pipeline. The JSX in
 * MarkdownBody.tsx cannot be imported here (vitest runs in a node environment
 * with no react-native), so the decisions the rules make live in
 * markdownRules.ts and are covered directly; the wiring is covered by the
 * source assertions at the bottom and by the /push-phone device gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
import {
	ALLOWED_IMAGE_HANDLERS,
	configureLinkify,
	DEFAULT_IMAGE_HANDLER,
	isLastChildOfBlockquote,
	isScriptureBlockquote,
	LINKIFY_TLDS,
	NOTE_ALLOWED_IMAGE_HANDLERS,
	softbreakContent,
	type MarkdownNodeLike,
} from "./markdownRules";
import { verseReferencePlugin, VERSE_REF_SCHEME } from "./verseLinks";

const SRC = join(__dirname, "..", "..");

interface RealToken {
	type: string;
	content: string;
	attrs: [string, string][] | null;
	children?: RealToken[];
}

/** The exact instance MarkdownBody builds: typographer, linkify, both tweaks. */
function sureWordParser() {
	const md = new MarkdownIt({ typographer: true, linkify: true });
	configureLinkify(md);
	md.use(verseReferencePlugin);
	return md;
}

function hrefsOf(markdown: string, md = sureWordParser()): string[] {
	const hrefs: string[] = [];
	const walk = (tokens: RealToken[]) => {
		for (const token of tokens) {
			if (token.type === "link_open" && token.attrs) {
				const href = token.attrs.find(([name]) => name === "href");
				if (href) hrefs.push(href[1]);
			}
			if (token.children) walk(token.children);
		}
	};
	walk(md.parse(markdown, {}) as RealToken[]);
	return hrefs;
}

describe("B2 linkify keeps the defaults plus a curated ccTLD keep-list", () => {
	it("does not link a missing space after a full stop", () => {
		// Every one of these became a tappable http:// link that left the app.
		expect(hrefsOf("He is God.It is written. The word.Is it true? Grace.To all.")).toEqual([]);
		expect(hrefsOf("God.We know")).toEqual([]);
	});

	it("does not link the sentence openers whose ccTLD was dropped", () => {
		const openers = ["It", "Is", "To", "Do", "So", "No", "My", "At", "By", "As", "Am", "Ye"];
		for (const opener of openers) {
			expect(hrefsOf(`Trust the word.${opener} follows.`)).toEqual([]);
		}
	});

	it("no longer links Be/In/Me/Us either, the openers that used to survive", () => {
		// be/in/me/us were kept for youtu.be, .in hosts, me.com and .us domains,
		// at the price of "the word.Be strong" linking mid-sentence. That trade
		// was reversed: a phantom link inside a Scripture answer is the worse
		// failure, and a model can still write a full https:// URL. This test
		// exists so putting any of the four back is a decision, not an accident.
		for (const opener of ["Be", "In", "Me", "Us"]) {
			expect(hrefsOf(`Trust the word.${opener} follows.`)).toEqual([]);
		}
	});

	it("keeps explicit-scheme, www. and bare-domain links tappable", () => {
		expect(hrefsOf("https://example.com")).toEqual(["https://example.com"]);
		expect(hrefsOf("www.gotquestions.org")).toEqual(["http://www.gotquestions.org"]);
		expect(hrefsOf("See biblegateway.com now")).toEqual(["http://biblegateway.com"]);
		expect(hrefsOf("mail me at a@b.com")).toEqual(["mailto:a@b.com"]);
	});

	it("keeps the short-link and ccTLD hosts models actually cite", () => {
		expect(hrefsOf("bit.ly/abc")).toEqual(["http://bit.ly/abc"]);
		expect(hrefsOf("www.bbc.co.uk/news")).toEqual(["http://www.bbc.co.uk/news"]);
	});

	it("gives up bare youtu.be, the price of keeping 'word.Be' plain", () => {
		expect(hrefsOf("youtu.be/x")).toEqual([]);
		// Written in full it still links, which is the whole reason the trade is
		// affordable.
		expect(hrefsOf("https://youtu.be/x")).toEqual(["https://youtu.be/x"]);
	});

	it("still links verse references alongside real URLs", () => {
		expect(hrefsOf("John 3:16 is quoted at https://example.com")).toEqual([
			`${VERSE_REF_SCHEME}John 3:16`,
			"https://example.com",
		]);
	});

	it("carries only the curated two-letter TLDs, not the whole ccTLD block", () => {
		expect(LINKIFY_TLDS.filter((tld) => /^[a-z]{2}$/i.test(tld))).toEqual([
			"ly",
			"co",
			"uk",
			"io",
			"tv",
			"gg",
			"ai",
			"fm",
			"cc",
			"de",
			"fr",
			"ca",
			"au",
			"nz",
		]);
		// The four that were removed, named so the list cannot regain them quietly.
		for (const opener of ["be", "in", "me", "us"]) {
			expect(LINKIFY_TLDS).not.toContain(opener);
		}
	});

	it("keeps every linkify default TLD, so narrowing is additive only", () => {
		for (const tld of ["biz", "com", "edu", "gov", "net", "org", "pro", "web", "xxx", "aero", "asia", "coop", "info", "museum", "name", "shop"]) {
			expect(LINKIFY_TLDS).toContain(tld);
		}
	});
});

describe("B1 softbreak reflows prose but not Scripture", () => {
	it("collapses a softbreak in an ordinary paragraph to a space", () => {
		expect(softbreakContent([{ type: "paragraph" }, { type: "body" }])).toBe(" ");
	});

	it("keeps the line break inside a blockquote", () => {
		expect(
			softbreakContent([{ type: "paragraph" }, { type: "blockquote" }, { type: "body" }])
		).toBe("\n");
	});

	it("reflows a list item that merely happens to sit inside a blockquote", () => {
		// Only the NEAREST block ancestor decides. A wrapped bullet inside a
		// quoted block is prose, not Scripture layout, so it must collapse.
		expect(
			softbreakContent([
				{ type: "list_item" },
				{ type: "bullet_list" },
				{ type: "blockquote" },
				{ type: "body" },
			])
		).toBe(" ");
		expect(
			softbreakContent([
				{ type: "paragraph" },
				{ type: "list_item" },
				{ type: "ordered_list" },
				{ type: "blockquote" },
				{ type: "body" },
			])
		).toBe(" ");
	});

	it("reflows a table cell inside a blockquote", () => {
		expect(
			softbreakContent([{ type: "td" }, { type: "tr" }, { type: "blockquote" }, { type: "body" }])
		).toBe(" ");
	});

	it("fires on hard-wrapped model prose", () => {
		// The repro: the model wraps its own paragraph, Android kept the ragged edge.
		const wrapped =
			"Beloved, the doctrine of assurance is not presumption. It rests\nentirely upon the finished work of Christ, and upon the plain\npromises of God in his word.";
		const inline = (sureWordParser().parse(wrapped, {}) as RealToken[]).find(
			(token) => token.type === "inline"
		);
		const softbreaks = (inline?.children ?? []).filter((token) => token.type === "softbreak");
		expect(softbreaks).toHaveLength(2);
	});
});

describe("B5 the last paragraph in a blockquote drops its bottom margin", () => {
	const paragraph = (index: number): MarkdownNodeLike => ({
		type: "paragraph",
		index,
		children: [],
	});
	const blockquote = (count: number): MarkdownNodeLike => ({
		type: "blockquote",
		index: 0,
		children: Array.from({ length: count }, (_, i) => paragraph(i)),
	});

	it("is true for the final paragraph of the card", () => {
		expect(isLastChildOfBlockquote(paragraph(1), [blockquote(2), { type: "body", index: 0, children: [] }])).toBe(true);
	});

	it("is false for an earlier paragraph in the same card", () => {
		expect(isLastChildOfBlockquote(paragraph(0), [blockquote(2)])).toBe(false);
	});

	it("is false outside a blockquote, so ordinary paragraphs keep their spacing", () => {
		expect(isLastChildOfBlockquote(paragraph(0), [{ type: "body", index: 0, children: [paragraph(0)] }])).toBe(
			false
		);
	});

	it("is false when there is no parent at all", () => {
		expect(isLastChildOfBlockquote(paragraph(0), [])).toBe(false);
	});
});

describe("B6 Scripture typography is limited to validated verse quotes", () => {
	it("keeps an ordinary supporting quote in the body family", () => {
		expect(
			isScriptureBlockquote([
				{ type: "blockquote", children: [{ type: "text", attributes: {}, children: [] }] },
			])
		).toBe(false);
	});

	it("recognises a verse link nested inside a blockquote", () => {
		expect(
			isScriptureBlockquote([
				{
					type: "paragraph",
					children: [],
				},
				{
					type: "blockquote",
					children: [
						{
							type: "paragraph",
							children: [
								{
									type: "link",
									attributes: { href: "verse-ref:John 3:16" },
									children: [],
								},
							],
						},
					],
				},
			])
		).toBe(true);
	});

	it("does not treat an external link as Scripture", () => {
		expect(
			isScriptureBlockquote([
				{
					type: "blockquote",
					children: [
						{ type: "link", attributes: { href: "https://example.com" }, children: [] },
					],
				},
			])
		).toBe(false);
	});
});

describe("B1/B5 against the AST the library really builds", () => {
	// The exact pipeline from react-native-markdown-display/src/lib/parser.js.
	const buildAst = async (markdown: string): Promise<MarkdownNodeLike[]> => {
		const base = "react-native-markdown-display/src/lib/util";
		const { cleanupTokens } = await import(`${base}/cleanupTokens`);
		const groupTextTokens = (await import(`${base}/groupTextTokens`)).default;
		const omitListItemParagraph = (await import(`${base}/omitListItemParagraph`)).default;
		const tokensToAST = (await import(`${base}/tokensToAST`)).default;
		let tokens = sureWordParser().parse(markdown, {});
		tokens = cleanupTokens(tokens);
		tokens = groupTextTokens(tokens);
		tokens = omitListItemParagraph(tokens);
		return tokensToAST(tokens) as MarkdownNodeLike[];
	};

	/** Mirrors AstRenderer: parentNodes[0] is the immediate parent. */
	const visitAll = (
		nodes: readonly MarkdownNodeLike[],
		parents: readonly MarkdownNodeLike[],
		visit: (node: MarkdownNodeLike, parents: readonly MarkdownNodeLike[]) => void
	): void => {
		for (const node of nodes) {
			visit(node, parents);
			visitAll(node.children as MarkdownNodeLike[], [node, ...parents], visit);
		}
	};

	const root = (children: MarkdownNodeLike[]): MarkdownNodeLike => ({
		type: "body",
		index: 0,
		children,
	});

	it("flushes only the final paragraph of a Scripture card", async () => {
		const ast = await buildAst(
			"> For God so loved the world\n>\n> John 3:16, KJV\n\nAnd a following paragraph."
		);
		const flushed: boolean[] = [];
		visitAll(ast, [root(ast)], (node, parents) => {
			if (node.type === "paragraph") flushed.push(isLastChildOfBlockquote(node, parents));
		});
		// Two paragraphs inside the card, one outside it.
		expect(flushed).toEqual([false, true, false]);
	});

	it("reflows a wrapped paragraph but keeps the break inside a blockquote", async () => {
		const ast = await buildAst("one\ntwo\n\n> verse line one\n> verse line two");
		const rendered: string[] = [];
		visitAll(ast, [root(ast)], (node, parents) => {
			if (node.type === "softbreak") rendered.push(softbreakContent(parents));
		});
		expect(rendered).toEqual([" ", "\n"]);
	});

	it("reflows a wrapped bullet inside a blockquote, against the real AST", async () => {
		const ast = await buildAst("> - first line\n>   second line\n> - other");
		const rendered: string[] = [];
		visitAll(ast, [root(ast)], (node, parents) => {
			if (node.type === "softbreak") rendered.push(softbreakContent(parents));
		});
		expect(rendered).toEqual([" "]);
	});

	/** Every block child of the card, in order, with its flush verdict. */
	const flushVerdicts = async (markdown: string): Promise<[string, boolean][]> => {
		const ast = await buildAst(markdown);
		const verdicts: [string, boolean][] = [];
		visitAll(ast, [root(ast)], (node, parents) => {
			if (parents[0]?.type === "blockquote") {
				verdicts.push([node.type, isLastChildOfBlockquote(node, parents)]);
			}
		});
		return verdicts;
	};

	it("flushes a card that ends in a bullet list, not the paragraph above it", async () => {
		expect(await flushVerdicts("> intro\n>\n> - a\n> - b")).toEqual([
			["paragraph", false],
			["bullet_list", true],
		]);
	});

	it("flushes a card that ends in an ordered list", async () => {
		expect(await flushVerdicts("> intro\n>\n> 1. a\n> 2. b")).toEqual([
			["paragraph", false],
			["ordered_list", true],
		]);
	});

	it("flushes a card that opens with a heading and ends in a list", async () => {
		expect(await flushVerdicts("> ## H\n>\n> - a")).toEqual([
			["heading2", false],
			["bullet_list", true],
		]);
	});

	it("flushes a card that ends in a heading", async () => {
		expect(await flushVerdicts("> intro\n>\n> ## H")).toEqual([
			["paragraph", false],
			["heading2", true],
		]);
	});
});

describe("B8 images", () => {
	it("allows only real network sources in chat", () => {
		expect(ALLOWED_IMAGE_HANDLERS).toEqual(["https://", "http://"]);
		expect(ALLOWED_IMAGE_HANDLERS.some((handler) => handler.startsWith("data:"))).toBe(false);
	});

	it("keeps the library's data: handlers for notes, which carry pasted images", () => {
		expect(NOTE_ALLOWED_IMAGE_HANDLERS).toEqual([
			"data:image/png;base64",
			"data:image/gif;base64",
			"data:image/jpeg;base64",
			// The library's default list predates webp; every modern screenshot
			// tool emits it, so leaving it off blanked perfectly good pasted images.
			"data:image/webp;base64",
			"https://",
			"http://",
		]);
	});

	it("wires the notes panel to the wider list and still to the null default", () => {
		const source = readFileSync(
			join(SRC, "features", "notes", "components", "NoteMarkdown.tsx"),
			"utf8"
		);
		expect(source).toContain("allowedImageHandlers={NOTE_ALLOWED_IMAGE_HANDLERS}");
		expect(source).toContain("defaultImageHandler={DEFAULT_IMAGE_HANDLER}");
	});

	it("renders nothing rather than fabricating a URL for a disallowed source", () => {
		// The library prepends defaultImageHandler to a disallowed src, so the
		// string default turned `data:image/png;base64,...` into
		// `https://data:image/png;base64,...`; null makes the rule return null.
		expect(DEFAULT_IMAGE_HANDLER).toBeNull();
	});

	it("still parses the disallowed forms as images, so the rule is what decides", () => {
		for (const markdown of ["![chart](data:image/png;base64,iVBORw0KGgo=)", "![x](/static/a.png)"]) {
			const inline = (sureWordParser().parse(markdown, {}) as RealToken[]).find(
				(token) => token.type === "inline"
			);
			expect((inline?.children ?? []).some((token) => token.type === "image")).toBe(true);
		}
	});
});

describe("the verse plugin introduces no token type the renderer lacks a rule for", () => {
	it("emits only link_open/text/link_close", () => {
		const before = new Set<string>();
		const after = new Set<string>();
		const corpus = [
			"John 3:16 says it.",
			"## 2 Peter 1:19 in the NKJV",
			"> For God so loved the world\n> John 3:16",
			"| Reference | Note |\n| --- | --- |\n| John 3:16 | love |",
			"- Read Romans 8:28\n- Then 1 Cor. 2:14",
			"`John 3:16` and [John 3:16](https://example.com)",
		];
		const plain = new MarkdownIt({ typographer: true, linkify: true });
		configureLinkify(plain);
		const collect = (tokens: RealToken[], into: Set<string>) => {
			for (const token of tokens) {
				into.add(token.type);
				if (token.children) collect(token.children, into);
			}
		};
		for (const markdown of corpus) {
			collect(plain.parse(markdown, {}) as RealToken[], before);
			collect(sureWordParser().parse(markdown, {}) as RealToken[], after);
		}
		const added = [...after].filter((type) => !before.has(type));
		expect(added).toEqual([]);
	});
});

describe("B3 every mobile assistant renderer normalizes", () => {
	it.each([
		["chat", join(SRC, "features", "chat", "MessageBubble.tsx")],
		["notes", join(SRC, "features", "notes", "components", "NoteAIMessage.tsx")],
	])("%s renderer calls normalizeAssistantMarkdown", (_label, file) => {
		expect(readFileSync(file, "utf8")).toContain("normalizeAssistantMarkdown(");
	});
});

describe("MarkdownBody wiring", () => {
	const source = readFileSync(join(SRC, "features", "chat", "MarkdownBody.tsx"), "utf8");

	it("keeps every AstRenderer memo dependency at module scope", () => {
		// An inline object/array/element here rebuilds the renderer and reparses
		// the whole document on every render.
		for (const prop of [
			"rules={sureWordMarkdownRules}",
			"allowedImageHandlers={ALLOWED_IMAGE_HANDLERS}",
			"defaultImageHandler={DEFAULT_IMAGE_HANDLER}",
			"topLevelMaxExceededItem={truncationMarker}",
		]) {
			expect(source).toContain(prop);
		}
	});

	it("narrows linkify before the verse plugin is installed", () => {
		expect(source).toContain("configureLinkify(markdownIt)");
	});

	it("wires the flush-margin predicate to every block that can end a card", () => {
		for (const rule of [
			"paragraph: flushableBlock(",
			"bullet_list: flushableBlock(",
			"ordered_list: flushableBlock(",
			"heading1: flushableBlock(",
			"heading2: flushableBlock(",
			"heading3: flushableBlock(",
			"heading4: flushableBlock(",
			"heading5: flushableBlock(",
			"heading6: flushableBlock(",
		]) {
			expect(source).toContain(rule);
		}
	});
});

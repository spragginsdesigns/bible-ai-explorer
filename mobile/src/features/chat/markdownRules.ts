/**
 * The pure half of MarkdownBody's renderer configuration: data and predicates
 * with no React or react-native imports, so the vitest suite (node
 * environment) can cover them. MarkdownBody.tsx holds the JSX that uses them,
 * and NoteMarkdown.tsx reuses the image constants.
 */

/** The slice of an AST node the rules below need. */
export interface MarkdownNodeLike {
	type: string;
	index: number;
	children: readonly unknown[];
}

/**
 * linkify-it's own default generic TLDs, copied verbatim from
 * linkify-it/index.js (`tlds_default`). Repeated here because the only way to
 * influence the two-character block below is `tlds(list, false)`, which
 * REPLACES the default list wholesale.
 */
const LINKIFY_DEFAULT_TLDS = [
	"biz",
	"com",
	"edu",
	"gov",
	"net",
	"org",
	"pro",
	"web",
	"xxx",
	"aero",
	"asia",
	"coop",
	"info",
	"museum",
	"name",
	"shop",
	// U+0440 U+0444, linkify-it's one non-ASCII default TLD. Kept so replacing
	// the list is not also a silent regression for it.
	"рф",
];

/**
 * Two-character TLDs worth keeping. linkify-it's default list carries the WHOLE
 * ccTLD block, which turns a missing space after a full stop into a tappable
 * link that leaves the app: "God.It", "word.Is" and "Grace.To" all became
 * http:// links. Dropping the block entirely was the first fix and went too far
 * - it also killed "bit.ly/abc" and "www.bbc.co.uk/news", which models link
 * constantly. So the block is replaced by this curated keep-list.
 *
 * "be", "in", "me" and "us" were on this list and are deliberately NOT any
 * more. Each of the four is also an English sentence opener, so "the word.Be
 * strong" still produced a tappable http://word.Be - and in a Scripture answer
 * a phantom link mid-sentence is the worse failure. Losing them costs
 * youtu.be/x, .in hosts, me.com-style hosts and .us domains, all of which a
 * model can still write as a full https:// URL. Nothing two-letter goes back on
 * without the same trade weighed out loud; markdownBody.test.ts pins both
 * halves of it.
 */
const LINKIFY_KEPT_CCTLDS = [
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
];

/** The exact list handed to linkify: defaults plus the curated ccTLDs. */
export const LINKIFY_TLDS = [...LINKIFY_DEFAULT_TLDS, ...LINKIFY_KEPT_CCTLDS];

interface LinkifyCapable {
	linkify: { tlds(list: string[], keepOld: boolean): unknown };
}

/**
 * Replace linkify's TLD list on a markdown-it instance. Replacing rather than
 * emptying keeps explicit-scheme links, "www." links and bare
 * "gotquestions.org" working, which `fuzzyLink: false` would not. See
 * LINKIFY_TLDS.
 */
export function configureLinkify(md: LinkifyCapable): void {
	md.linkify.tlds(LINKIFY_TLDS, false);
}

/**
 * AST node types that open a new block context around a softbreak. `paragraph`
 * is deliberately absent: it is transparent here, so a softbreak in a paragraph
 * that sits directly inside a blockquote still resolves to the blockquote.
 */
const SOFTBREAK_BLOCK_ANCESTORS = new Set([
	"blockquote",
	"body",
	"bullet_list",
	"ordered_list",
	"list_item",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"heading1",
	"heading2",
	"heading3",
	"heading4",
	"heading5",
	"heading6",
	"code_block",
	"fence",
]);

/**
 * react-native-markdown-display hard-codes the softbreak rule to a literal
 * newline (lib/renderRules.js:323) and never styles it, so Android behaves as
 * if `breaks: true` and keeps the model's hard-wrapped ragged right edge, while
 * the web renderer collapses the same softbreak to a space. Reflow ordinary
 * prose to match web - but keep the newline inside a blockquote, where the line
 * breaks are the poetry/Scripture layout rather than an artifact of wrapping.
 *
 * Only the NEAREST block ancestor decides. A softbreak inside a list item that
 * happens to live in a blockquote is ordinary wrapped prose and must reflow;
 * scanning the whole ancestor chain for a blockquote kept its ragged edge.
 */
export function softbreakContent(parents: readonly { type: string }[]): string {
	for (const parent of parents) {
		if (SOFTBREAK_BLOCK_ANCESTORS.has(parent.type)) {
			return parent.type === "blockquote" ? "\n" : " ";
		}
	}
	return " ";
}

/**
 * The blockquote card carries paddingVertical and each block inside it carries
 * marginBottom, so the last block's margin stacks on the card's padding: 12px
 * of space above the verse and 24px below it. True for whichever block should
 * drop its bottom margin - a card can end in a paragraph, a list or a heading,
 * and MarkdownBody wires all three to this predicate.
 */
export function isLastChildOfBlockquote(
	node: MarkdownNodeLike,
	parents: readonly MarkdownNodeLike[]
): boolean {
	const parent = parents[0];
	if (!parent || parent.type !== "blockquote") return false;
	return node.index === parent.children.length - 1;
}

/**
 * Image sources chat may fetch. Deliberately narrower than the library default:
 * an assistant answer has no reason to inline a data: URI, and a multi-megabyte
 * base64 blob in a streamed message is a rendering hazard.
 */
export const ALLOWED_IMAGE_HANDLERS = ["https://", "http://"];

/**
 * The notes panel keeps the library's defaults, data: URIs included - notes
 * carry pasted and generated images, and stripping the data: handlers there
 * would blank images that used to render.
 */
export const NOTE_ALLOWED_IMAGE_HANDLERS = [
	"data:image/png;base64",
	"data:image/gif;base64",
	"data:image/jpeg;base64",
	// webp is what every modern screenshot tool and image pipeline emits now, so
	// leaving it off blanked pasted images that had nothing wrong with them.
	"data:image/webp;base64",
	"https://",
	"http://",
];

/**
 * The library's default is the string "https://", which it PREPENDS to a
 * disallowed src - turning `![x](data:image/png;base64,...)` into a request for
 * `https://data:image/png;base64,...`, a FitImage that spins forever. null
 * makes the image rule return null instead (lib/renderRules.js:282).
 */
export const DEFAULT_IMAGE_HANDLER = null;

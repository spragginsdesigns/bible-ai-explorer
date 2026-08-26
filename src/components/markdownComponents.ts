/**
 * The react-markdown renderer map for assistant answers.
 *
 * Why this is a plain .ts module built on React.createElement instead of JSX:
 * node --experimental-strip-types (how tests/ runs) can import .ts but not
 * .tsx, so keeping the map here lets tests/markdown-components.test.mjs render
 * the REAL renderers through react-dom/server instead of asserting against a
 * copy that can drift. FormattedResponse.tsx supplies the popover component.
 */
import React from "react";
import { Quote, Lightbulb, ChevronRight, CheckCircle } from "lucide-react";
import type { Components } from "react-markdown";
import type { TextSegment } from "../utils/verseParser";

const h = React.createElement;

export interface VerseRefProps {
	reference: string;
	children: React.ReactNode;
}

export type VerseRefComponent = React.ComponentType<VerseRefProps>;

/**
 * Injected rather than imported. Node's type stripper resolves `import type`
 * away but cannot resolve an extensionless runtime import of a .ts file, so
 * taking both collaborators as arguments is what keeps this module loadable
 * from the test runner without an extension hack in the import path.
 */
export interface MarkdownRendererDeps {
	/** Wraps a detected reference in the clickable popover. */
	VerseRef: VerseRefComponent;
	/** Splits prose into plain-text and verse-reference segments. */
	parseVerseReferences: (text: string) => TextSegment[];
}

/**
 * Whether a rendered <li> sits inside a <ul> or an <ol>. react-markdown gives
 * list items no way to know their parent, so the list renderers provide it.
 * (react-markdown also hands `ul` the "\n" whitespace text nodes between <li>
 * elements as children - wrapping those children in icon rows was what
 * produced empty CheckCircle bullets, so lists render their children as-is
 * and let the `li` renderer own the layout.)
 */
const ListTypeContext = React.createContext<"ul" | "ol">("ul");

/**
 * Set by the `pre` renderer so the `code` renderer can tell a fenced block
 * (already inside a styled <pre>) from an inline span. Checking for a
 * `language-*` className is not enough: a fence with no language, and an
 * indented code block, both arrive with no className at all.
 */
const InPreContext = React.createContext(false);

/** Tags that carry meaning with no children, so "empty" does not mean blank. */
const VOID_TAGS = new Set(["img", "hr", "br", "input"]);

/** The hast node react-markdown hands every renderer as `props.node`. */
interface HastElementProps {
	children?: React.ReactNode;
	node?: { tagName?: string };
}

/**
 * True when a subtree renders nothing a reader would see. Used to suppress the
 * fully-chromed blockquote card for a mid-stream "> " that has no content yet.
 *
 * The tag has to come off `props.node`, not off `element.type`: every element
 * in this subtree was created by react-markdown against the map below, so its
 * `type` is a renderer FUNCTION and never the tag string. Testing `type`
 * matched nothing, which made "> ![alt](/a.png)" and "> ---" look blank and
 * rendered as nothing at all.
 */
function isBlankNode(node: React.ReactNode): boolean {
	if (node === null || node === undefined || typeof node === "boolean") return true;
	if (typeof node === "string") return node.trim() === "";
	if (typeof node === "number") return false;
	if (Array.isArray(node)) return node.every(isBlankNode);
	if (React.isValidElement(node)) {
		const props = node.props as HastElementProps;
		const tagName =
			typeof node.type === "string" ? node.type : props.node?.tagName;
		if (typeof tagName === "string" && VOID_TAGS.has(tagName)) return false;
		return isBlankNode(props.children);
	}
	return false;
}

/** A link that leaves the app, and so needs target/rel hardening. */
function isExternalHref(href: string | undefined): boolean {
	if (typeof href !== "string") return false;
	// A protocol-relative "//example.com" borrows the page's scheme and still
	// leaves the app, so it needs the same hardening as an absolute URL.
	return /^https?:\/\//i.test(href) || href.startsWith("//");
}

/** Build the renderer map around a verse-reference component and parser. */
export function createMarkdownComponents({
	VerseRef,
	parseVerseReferences,
}: MarkdownRendererDeps): Components {
	/**
	 * Recursively process React children to wrap Bible verse references with
	 * clickable popovers.
	 */
	function processChildren(children: React.ReactNode): React.ReactNode {
		return React.Children.map(children, (child) => {
			if (typeof child === "string") {
				const segments = parseVerseReferences(child);
				if (segments.length === 1 && segments[0].type === "text") {
					return child;
				}
				return segments.map((seg, i) =>
					seg.type === "verse-ref"
						? h(VerseRef, {
								key: i,
								reference: seg.value,
								children: seg.value,
							})
						: h(React.Fragment, { key: i }, seg.value)
				);
			}
			return child;
		});
	}

	const components: Components = {
		p: ({ children }) =>
			h(
				"p",
				{ className: "mb-4 text-neutral-700 dark:text-neutral-300 leading-relaxed" },
				processChildren(children)
			),
		h1: ({ children }) =>
			h(
				"h1",
				{
					className:
						"text-2xl sm:text-3xl font-bold mb-4 text-neutral-900 dark:text-white border-b border-black/[0.1] dark:border-white/[0.08] pb-2",
				},
				processChildren(children)
			),
		// The heading text lives in ONE <span> child on purpose. When each
		// processed segment was its own flex item, flexbox stripped the spaces
		// between them and "## 2 Peter 1:19 in the NKJV" rendered as
		// "2 Peter 1:19in the NKJV".
		h2: ({ children }) =>
			h(
				"h2",
				{
					className:
						"text-xl sm:text-2xl font-semibold mb-3 text-neutral-800 dark:text-neutral-200 flex items-center",
				},
				h(Lightbulb, {
					className:
						"w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0 text-amber-600 dark:text-amber-400",
				}),
				h("span", { className: "min-w-0" }, processChildren(children))
			),
		h3: ({ children }) =>
			h(
				"h3",
				{
					className:
						"text-lg sm:text-xl font-medium mb-2 text-neutral-700 dark:text-neutral-300 flex items-center",
				},
				h(ChevronRight, {
					className: "w-4 h-4 sm:w-5 sm:h-5 mr-2 flex-shrink-0 text-neutral-500",
				}),
				h("span", { className: "min-w-0" }, processChildren(children))
			),
		h4: ({ children }) =>
			h(
				"h4",
				{
					className:
						"text-base sm:text-lg font-semibold mt-4 mb-2 text-neutral-800 dark:text-neutral-200",
				},
				processChildren(children)
			),
		h5: ({ children }) =>
			h(
				"h5",
				{
					className:
						"text-sm sm:text-base font-semibold mt-3 mb-2 text-neutral-700 dark:text-neutral-300",
				},
				processChildren(children)
			),
		h6: ({ children }) =>
			h(
				"h6",
				{
					className:
						"text-xs sm:text-sm font-semibold uppercase tracking-wide mt-3 mb-2 text-neutral-500 dark:text-neutral-400",
				},
				processChildren(children)
			),
		ul: ({ children }) =>
			h(
				ListTypeContext.Provider,
				{ value: "ul" },
				h(
					"ul",
					{
						className:
							"list-none mb-4 text-neutral-700 dark:text-neutral-300 space-y-2",
					},
					children
				)
			),
		// `start` is forwarded so "3. …" keeps its numbering instead of
		// silently restarting at 1.
		ol: ({ children, start }) =>
			h(
				ListTypeContext.Provider,
				{ value: "ol" },
				h(
					"ol",
					{
						start,
						className:
							"list-decimal list-inside mb-4 text-neutral-700 dark:text-neutral-300 space-y-2",
					},
					children
				)
			),
		li: ({ children, className }) => {
			// eslint-disable-next-line react-hooks/rules-of-hooks -- component, not a callback
			const listType = React.useContext(ListTypeContext);
			// remark-gfm marks task items and renders their own checkbox, so the
			// CheckCircle bullet would be a second marker on the same row.
			const isTaskItem =
				typeof className === "string" && className.includes("task-list-item");
			if (isTaskItem || listType === "ol") {
				return h(
					"li",
					{
						className:
							"text-neutral-700 dark:text-neutral-300 [&>*:last-child]:mb-0",
					},
					processChildren(children)
				);
			}
			return h(
				"li",
				{ className: "flex items-start text-neutral-700 dark:text-neutral-300" },
				h(CheckCircle, {
					className:
						"w-4 h-4 sm:w-5 sm:h-5 mr-2 mt-0.5 flex-shrink-0 text-neutral-500",
				}),
				// A <div>, not a <span>: react-markdown puts a block <p> inside
				// every item of a loose list, which a <span> may not contain.
				// `[&>*:last-child]:mb-0` is what makes a loose list and a tight
				// list sit at the same rhythm instead of one gaining 16px. The
				// selector is `*`, not `p`: an item can just as easily end in a
				// nested list, a heading, a <pre> or a table wrapper, and every
				// one of those carries its own bottom margin too.
				h(
					"div",
					{ className: "min-w-0 flex-1 [&>*:last-child]:mb-0" },
					processChildren(children)
				)
			);
		},
		input: ({ checked, type }) =>
			type === "checkbox"
				? h("input", {
						type: "checkbox",
						checked: Boolean(checked),
						readOnly: true,
						disabled: true,
						className:
							"mr-2 align-[-0.1em] accent-amber-600 dark:accent-amber-400",
					})
				: null,
		strong: ({ children }) =>
			h(
				"strong",
				{ className: "text-neutral-900 dark:text-white font-semibold" },
				processChildren(children)
			),
		em: ({ children }) =>
			h(
				"em",
				{ className: "text-neutral-800 dark:text-neutral-200 italic" },
				processChildren(children)
			),
		del: ({ children }) =>
			h(
				"del",
				{ className: "line-through text-neutral-500 dark:text-neutral-500" },
				processChildren(children)
			),
		// Deliberately NOT processChildren: a verse popover is a <button>, and
		// nesting one inside an anchor is invalid and untappable.
		a: ({ children, href, title }) =>
			h(
				"a",
				{
					href,
					title,
					...(isExternalHref(href)
						? { target: "_blank", rel: "noopener noreferrer" }
						: {}),
					className:
						"text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline decoration-black/20 dark:decoration-white/20 hover:decoration-black/40 dark:hover:decoration-white/40 underline-offset-2 transition-colors",
				},
				children
			),
		blockquote: ({ children }) => {
			// A mid-stream "> " with nothing after it would otherwise flash a
			// fully-chromed empty card.
			if (isBlankNode(children)) return null;
			return h(
				"blockquote",
				{
					className:
						"border-l-2 border-black/20 dark:border-white/20 pl-4 my-4 italic text-neutral-600 dark:text-neutral-400 bg-black/[0.02] dark:bg-white/[0.02] py-3 pr-3 rounded-r-lg font-[family-name:var(--font-cormorant)] text-lg",
				},
				h(
					"div",
					{ className: "flex items-start" },
					h(Quote, {
						className:
							"w-4 h-4 sm:w-5 sm:h-5 mr-2 mt-1 flex-shrink-0 text-amber-600/60 dark:text-amber-400/60",
					}),
					// [&>*:last-child]:mb-0 removes the bottom margin that stacked
					// on the card's own bottom padding. `*` rather than `p`
					// because a quote can end in a list, a heading, a fenced
					// block or a table just as easily as in a paragraph, and the
					// `p`-only selector left every one of those a margin short.
					h(
						"div",
						{ className: "min-w-0 flex-1 [&>*:last-child]:mb-0" },
						processChildren(children)
					)
				)
			);
		},
		pre: ({ children }) =>
			h(
				InPreContext.Provider,
				{ value: true },
				h(
					"pre",
					{
						className:
							"mb-4 overflow-x-auto rounded-lg bg-black/[0.04] dark:bg-white/[0.04] p-3 text-sm",
					},
					children
				)
			),
		code: ({ children, className }) => {
			// eslint-disable-next-line react-hooks/rules-of-hooks -- component, not a callback
			const inPre = React.useContext(InPreContext);
			if (inPre) {
				return h(
					"code",
					{
						className: `font-mono text-neutral-800 dark:text-neutral-200${
							className ? ` ${className}` : ""
						}`,
					},
					children
				);
			}
			return h(
				"code",
				{
					className:
						"rounded bg-black/[0.06] dark:bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.9em] text-amber-700 dark:text-amber-300",
				},
				children
			);
		},
		// The wrapper is what keeps a wide table from scrolling the whole page
		// sideways on a phone.
		table: ({ children }) =>
			h(
				"div",
				{ className: "my-4 overflow-x-auto" },
				h(
					"table",
					{
						className:
							"w-full text-sm border-collapse text-neutral-700 dark:text-neutral-300",
					},
					children
				)
			),
		thead: ({ children }) =>
			h("thead", { className: "bg-black/[0.03] dark:bg-white/[0.03]" }, children),
		tbody: ({ children }) => h("tbody", null, children),
		tr: ({ children }) => h("tr", null, children),
		// `style` is forwarded because remark-gfm expresses a column's
		// alignment (`| :--- | ---: |`) as an inline text-align on every cell;
		// dropping it left every column left-aligned.
		th: ({ children, style }) =>
			h(
				"th",
				{
					style,
					className:
						"border border-black/[0.1] dark:border-white/[0.1] px-3 py-2 text-left font-semibold text-neutral-800 dark:text-neutral-200",
				},
				processChildren(children)
			),
		td: ({ children, style }) =>
			h(
				"td",
				{
					style,
					className:
						"border border-black/[0.1] dark:border-white/[0.1] px-3 py-2 align-top",
				},
				processChildren(children)
			),
		// react-markdown's urlTransform sanitizes a source it will not allow -
		// a data: URI, a javascript: URL - down to the EMPTY STRING rather than
		// dropping the node. `<img src="">` makes the browser re-request the
		// page itself and paint a broken-image box in the middle of the answer,
		// so an empty src renders nothing at all.
		img: ({ src, alt, title }) => {
			if (typeof src !== "string" || src === "") return null;
			return h("img", {
				src,
				alt: alt ?? "",
				title,
				className: "max-w-full h-auto rounded-lg my-4",
			});
		},
		hr: () =>
			h("hr", {
				className:
					"my-6 border-0 border-t border-black/[0.1] dark:border-white/[0.08]",
			}),
	};

	return components;
}

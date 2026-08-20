import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	Quote,
	Lightbulb,
	ChevronRight,
	CheckCircle
} from "lucide-react";
import { parseVerseReferences } from "../utils/verseParser";
import VersePopover from "./VersePopover";

interface FormattedResponseProps {
	response: string | undefined;
}

/**
 * Recursively process React children to wrap Bible verse references
 * with clickable VersePopover components.
 */
function processChildren(children: React.ReactNode): React.ReactNode {
	return React.Children.map(children, (child) => {
		if (typeof child === "string") {
			const segments = parseVerseReferences(child);
			if (segments.length === 1 && segments[0].type === "text") {
				return child;
			}
			return segments.map((seg, i) =>
				seg.type === "verse-ref" ? (
					<VersePopover key={i} reference={seg.value}>
						{seg.value}
					</VersePopover>
				) : (
					<React.Fragment key={i}>{seg.value}</React.Fragment>
				)
			);
		}
		return child;
	});
}

/**
 * Whether a rendered <li> sits inside a <ul> or an <ol>. react-markdown gives
 * list items no way to know their parent, so the list renderers provide it.
 * (react-markdown also hands `ul` the "\n" whitespace text nodes between <li>
 * elements as children — wrapping those children in icon rows was what
 * produced empty CheckCircle bullets, so lists render their children as-is
 * and let the `li` renderer own the layout.)
 */
const ListTypeContext = React.createContext<"ul" | "ol">("ul");

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	if (!response || typeof response !== "string") {
		return (
			<div className="text-neutral-500 dark:text-neutral-400 font-semibold">
				No valid response available.
			</div>
		);
	}

	return (
		<div className="prose-neutral">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={markdownComponents}
			>
				{response}
			</ReactMarkdown>
		</div>
	);
};

const markdownComponents: React.ComponentProps<
	typeof ReactMarkdown
>["components"] = {
	p: ({ children }) => (
		<p className="mb-4 text-neutral-700 dark:text-neutral-300 leading-relaxed">
			{processChildren(children)}
		</p>
	),
	h1: ({ children }) => (
		<h1 className="text-2xl sm:text-3xl font-bold mb-4 text-neutral-900 dark:text-white border-b border-black/[0.1] dark:border-white/[0.08] pb-2">
			{processChildren(children)}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-xl sm:text-2xl font-semibold mb-3 text-neutral-800 dark:text-neutral-200 flex items-center">
			<Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-600 dark:text-amber-400" />
			{processChildren(children)}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-lg sm:text-xl font-medium mb-2 text-neutral-700 dark:text-neutral-300 flex items-center">
			<ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-neutral-500" />
			{processChildren(children)}
		</h3>
	),
	ul: ({ children }) => (
		<ListTypeContext.Provider value="ul">
			<ul className="list-none mb-4 text-neutral-700 dark:text-neutral-300 space-y-2">
				{children}
			</ul>
		</ListTypeContext.Provider>
	),
	ol: ({ children }) => (
		<ListTypeContext.Provider value="ol">
			<ol className="list-decimal list-inside mb-4 text-neutral-700 dark:text-neutral-300 space-y-2">
				{children}
			</ol>
		</ListTypeContext.Provider>
	),
	li: ({ children }) => {
		// eslint-disable-next-line react-hooks/rules-of-hooks -- component, not a callback
		const listType = React.useContext(ListTypeContext);
		if (listType === "ol") {
			return (
				<li className="text-neutral-700 dark:text-neutral-300">
					{processChildren(children)}
				</li>
			);
		}
		return (
			<li className="flex items-start text-neutral-700 dark:text-neutral-300">
				<CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-neutral-500 mt-0.5 flex-shrink-0" />
				<span>{processChildren(children)}</span>
			</li>
		);
	},
	strong: ({ children }) => (
		<strong className="text-neutral-900 dark:text-white font-semibold">{processChildren(children)}</strong>
	),
	em: ({ children }) => (
		<em className="text-neutral-800 dark:text-neutral-200 italic">{processChildren(children)}</em>
	),
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-black/20 dark:border-white/20 pl-4 my-4 italic text-neutral-600 dark:text-neutral-400 bg-black/[0.02] dark:bg-white/[0.02] py-3 pr-3 rounded-r-lg font-[family-name:var(--font-cormorant)] text-lg">
			<div className="flex items-start">
				<Quote className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-600/60 dark:text-amber-400/60 mt-1 flex-shrink-0" />
				<div>
					{processChildren(children)}
				</div>
			</div>
		</blockquote>
	),
};

export default FormattedResponse;

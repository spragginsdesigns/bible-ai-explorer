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

const FormattedResponse: React.FC<FormattedResponseProps> = ({ response }) => {
	if (!response || typeof response !== "string") {
		return (
			<div className="text-amber-500 font-semibold">
				No valid response available.
			</div>
		);
	}

	return (
		<div className="prose-amber">
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
		<p className="mb-4 text-amber-100/80 leading-relaxed">
			{processChildren(children)}
		</p>
	),
	h1: ({ children }) => (
		<h1 className="text-2xl sm:text-3xl font-bold mb-4 text-amber-500 border-b-2 border-amber-700/30 pb-2">
			{processChildren(children)}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-xl sm:text-2xl font-semibold mb-3 text-amber-500 flex items-center">
			<Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-400" />
			{processChildren(children)}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-lg sm:text-xl font-medium mb-2 text-amber-400 flex items-center">
			<ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500" />
			{processChildren(children)}
		</h3>
	),
	ul: ({ children }) => (
		<ul className="list-none mb-4 text-amber-100/80 space-y-2">
			{React.Children.map(children, child => (
				<li className="flex items-start">
					<CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500 mt-0.5" />
					<span>
						{child}
					</span>
				</li>
			))}
		</ul>
	),
	ol: ({ children }) => (
		<ol className="list-decimal list-inside mb-4 text-amber-100/80 space-y-2">
			{children}
		</ol>
	),
	li: ({ children }) => (
		<li className="text-amber-100/80">
			{processChildren(children)}
		</li>
	),
	strong: ({ children }) => (
		<strong className="text-amber-400 font-semibold">{processChildren(children)}</strong>
	),
	em: ({ children }) => (
		<em className="text-amber-200/90 italic">{processChildren(children)}</em>
	),
	blockquote: ({ children }) => (
		<blockquote className="border-l-4 border-amber-500 pl-4 my-4 italic text-amber-100/70 bg-black/40 py-3 pr-3 rounded-r-lg font-[family-name:var(--font-cormorant)] text-lg">
			<div className="flex items-start">
				<Quote className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-amber-500 mt-1 flex-shrink-0" />
				<div>
					{processChildren(children)}
				</div>
			</div>
		</blockquote>
	),
};

export default FormattedResponse;

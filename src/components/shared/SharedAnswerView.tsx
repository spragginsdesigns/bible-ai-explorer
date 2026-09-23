"use client";

import React, { createContext, useContext } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ArrowUpRight, BookOpen, MessageCircle } from "lucide-react";
import { createMarkdownComponents, type VerseRefProps } from "../markdownComponents";
import { parseVerseReferences } from "../../utils/verseParser";
import { sharedPassageLink } from "@/lib/shared-passage";
import CopyShareLink from "./CopyShareLink";
import SharedDownloads from "./SharedDownloads";

/**
 * The body of a public `/shared/[id]` page.
 *
 * A client component because the chat renderer map is the real one from
 * markdownComponents.ts and several of its renderers read React context, which
 * a server component cannot do. Sharing the map is the point: a shared answer
 * has to read exactly like the answer the sender saw.
 *
 * References open public passage readers with their source translation,
 * without using authenticated routes or changing the visitor's preferences.
 */
const SharedTranslation = createContext("");
const InsideSharedAnchor = createContext(false);
const PublicVerseRef: React.FC<VerseRefProps & { chip?: boolean }> = ({ reference, children, chip = false }) => {
	const translation = useContext(SharedTranslation);
	const insideAnchor = useContext(InsideSharedAnchor);
	const passage = sharedPassageLink(reference, translation);
	if (!passage || insideAnchor) return <span>{children}</span>;
	return (
		<a href={passage.href} target="_blank" rel="noopener noreferrer" title={`Read ${reference} (${passage.version})${passage.startingChapter ? ", starting chapter," : ""} on ${passage.provider} (opens in a new tab)`}
			className={chip ? "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-amber-600/25 bg-amber-500/10 px-3 py-2 text-metadata font-medium text-amber-800 transition-colors hover:bg-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:border-amber-400/25 dark:text-amber-300 dark:focus-visible:outline-amber-400" : "rounded-sm text-amber-700 underline decoration-amber-700/40 underline-offset-2 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:text-amber-400 dark:decoration-amber-400/40 dark:focus-visible:outline-amber-400"}>
			{children}{chip && <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
			<span className="sr-only"> (opens {passage.startingChapter ? "the starting chapter on " : "on "}{passage.provider} in a new tab)</span>
		</a>
	);
};

function visibleText(children: React.ReactNode): string {
	return React.Children.toArray(children).map((child) => {
		if (typeof child === "string" || typeof child === "number") return String(child);
		return React.isValidElement<{ children?: React.ReactNode }>(child) ? visibleText(child.props.children) : "";
	}).join("");
}

const baseMarkdownComponents = createMarkdownComponents({
	VerseRef: PublicVerseRef,
	parseVerseReferences,
});
const markdownComponents: typeof baseMarkdownComponents = {
	...baseMarkdownComponents,
	a: function SharedAnchor(props) {
		const translation = useContext(SharedTranslation);
		// Markdown citations can already be anchors to an authenticated reader.
		// Route their visible reference through the same public reading link.
		const reference = visibleText(props.children);
		const passage = sharedPassageLink(reference, translation);
		const href = passage?.href ?? props.href;
		const external = typeof href === "string" && /^(https?:\/\/|\/\/)/i.test(href);
		return <a href={href} title={passage ? `Read ${reference} (${passage.version})${passage.startingChapter ? ", starting chapter," : ""} on ${passage.provider} (opens in a new tab)` : props.title} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="text-amber-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:text-amber-400"><InsideSharedAnchor.Provider value={true}>{props.children}</InsideSharedAnchor.Provider>{passage && <span className="sr-only"> (opens {passage.startingChapter ? "the starting chapter on " : "on "}{passage.provider} in a new tab)</span>}</a>;
	},
};

/**
 * An answer rendered for somebody with no session: the real chat renderer,
 * with every Scripture reference opening a public reader instead of the
 * authenticated verse popover. Shared by this page and the landing page's
 * guest answers, which are the two places a signed-out reader sees one.
 */
export function PublicAnswerMarkdown({ answer, translation }: { answer: string; translation: string }) {
	return (
		<SharedTranslation.Provider value={translation}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
				{answer}
			</ReactMarkdown>
		</SharedTranslation.Provider>
	);
}

export interface SharedAnswerViewProps {
	question: string;
	answer: string;
	references: string[];
	translation: string;
}

const SharedAnswerView: React.FC<SharedAnswerViewProps> = ({
	question,
	answer,
	references,
	translation,
}) => (
	<SharedTranslation.Provider value={translation}>
	<main className="min-h-screen bg-background text-foreground selection:bg-amber-200 selection:text-neutral-950 dark:selection:bg-amber-400/30 dark:selection:text-amber-100">
		<div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-14">
			<header className="flex items-center justify-between gap-3">
			<Link
				href="/"
				className="inline-flex min-h-11 items-center gap-2.5 rounded-md text-support font-semibold text-neutral-900 transition-colors hover:text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-600 dark:text-neutral-100 dark:hover:text-amber-300 dark:focus-visible:outline-amber-400"
			>
				<BookOpen aria-hidden="true" className="h-5 w-5 text-amber-700 dark:text-amber-400" strokeWidth={1.75} />
				SureWord
			</Link>
				<CopyShareLink />
			</header>

			{question ? (
				<h1 className="mt-8 break-words font-[family-name:var(--font-cormorant)] text-4xl font-semibold leading-[1.12] text-neutral-900 [text-wrap:balance] sm:text-5xl dark:text-neutral-100">
					{question}
				</h1>
			) : null}

			<p className="mt-4 text-metadata text-neutral-600 dark:text-neutral-400">
				Shared answer · {translation}
			</p>

			{references.length > 0 ? (
				<ul className="mt-5 flex flex-wrap gap-2" aria-label="Scripture referenced">
					{references.map((reference) => (
						<li key={reference}>
							<PublicVerseRef reference={reference} chip>{reference}</PublicVerseRef>
						</li>
					))}
				</ul>
			) : null}

			<article className="mt-8 min-w-0 break-words border-t border-border pt-7 text-chat sm:mt-10 sm:pt-8">
				<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
					{answer}
				</ReactMarkdown>
			</article>

			<footer className="mt-12 rounded-2xl border border-amber-900/10 bg-amber-50/70 p-5 sm:mt-16 sm:p-7 dark:border-amber-200/10 dark:bg-amber-200/[0.035]">
				<div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
					<div>
						<h2 className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold leading-tight">Keep exploring Scripture.</h2>
						<p className="mt-2 max-w-xs text-support leading-relaxed text-neutral-600 dark:text-neutral-400">
							Shared from SureWord, a Bible study companion rooted in Scripture.
						</p>
					</div>
					<Link
						href="/#ask"
						className="group inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl bg-amber-400 px-5 py-3 text-control font-semibold text-neutral-950 shadow-sm transition-colors hover:bg-amber-300 active:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-700 sm:w-auto dark:focus-visible:outline-amber-300"
					>
						<MessageCircle aria-hidden="true" className="h-4 w-4" />
						Ask your own question
						<ArrowRight aria-hidden="true" className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
					</Link>
				</div>
				<SharedDownloads />
			</footer>
		</div>
	</main>
	</SharedTranslation.Provider>
);

export default SharedAnswerView;

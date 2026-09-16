"use client";

import React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents, type VerseRefProps } from "../markdownComponents";
import { parseVerseReferences } from "../../utils/verseParser";
import { ANDROID_APK_URL, MACOS_DMG_URL } from "../../lib/constants";

/**
 * The body of a public `/shared/[id]` page.
 *
 * A client component because the chat renderer map is the real one from
 * markdownComponents.ts and several of its renderers read React context, which
 * a server component cannot do. Sharing the map is the point: a shared answer
 * has to read exactly like the answer the sender saw.
 *
 * The one substitution is the verse reference. In chat a reference is a
 * popover that fetches the passage from an authenticated route; here the
 * visitor is signed out, so references render as inert emphasis with the same
 * colour and underline. Nothing on this page makes an API call.
 */
const ReadOnlyVerseRef: React.FC<VerseRefProps> = ({ children }) => (
	<span className="text-amber-600 underline decoration-black/20 underline-offset-2 dark:text-amber-400 dark:decoration-white/20">
		{children}
	</span>
);

const markdownComponents = createMarkdownComponents({
	VerseRef: ReadOnlyVerseRef,
	parseVerseReferences,
});

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
	<main className="min-h-screen bg-white text-neutral-900 dark:bg-[#0a0a0a] dark:text-neutral-100">
		<div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
			<Link
				href="/"
				className="inline-flex items-center gap-2 text-metadata font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400"
			>
				SureWord
			</Link>

			{question ? (
				<h1 className="mt-6 text-screen-title font-semibold leading-snug text-neutral-900 dark:text-white">
					{question}
				</h1>
			) : null}

			<p className="mt-3 text-metadata text-neutral-500 dark:text-neutral-400">
				Shared answer · {translation}
			</p>

			{references.length > 0 ? (
				<ul className="mt-5 flex flex-wrap gap-2" aria-label="Scripture referenced">
					{references.map((reference) => (
						<li
							key={reference}
							className="rounded-full border border-amber-600/25 bg-amber-500/10 px-3 py-1 text-metadata font-medium text-amber-700 dark:border-amber-400/25 dark:text-amber-300"
						>
							{reference}
						</li>
					))}
				</ul>
			) : null}

			<article className="mt-8 min-w-0 break-words text-chat">
				<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
					{answer}
				</ReactMarkdown>
			</article>

			<footer className="mt-12 border-t border-black/[0.1] pt-8 dark:border-white/[0.08]">
				<p className="text-support text-neutral-600 dark:text-neutral-400">
					Shared from SureWord, a Bible study companion rooted in Scripture.
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<Link
						href="/sign-up"
						className="rounded-lg bg-amber-600 px-4 py-2 text-control font-semibold text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-[#0a0a0a] dark:hover:bg-amber-400"
					>
						Ask your own question
					</Link>
					<a
						href={ANDROID_APK_URL}
						className="rounded-lg border border-black/[0.12] px-4 py-2 text-control font-medium text-neutral-700 transition-colors hover:border-black/25 dark:border-white/[0.14] dark:text-neutral-300 dark:hover:border-white/30"
					>
						Android app
					</a>
					<a
						href={MACOS_DMG_URL}
						className="rounded-lg border border-black/[0.12] px-4 py-2 text-control font-medium text-neutral-700 transition-colors hover:border-black/25 dark:border-white/[0.14] dark:text-neutral-300 dark:hover:border-white/30"
					>
						macOS app
					</a>
				</div>
			</footer>
		</div>
	</main>
);

export default SharedAnswerView;

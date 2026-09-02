"use client";

import React, { useCallback, useEffect, useState } from "react";
import { isRightToLeft, stripCantillation } from "@/lib/bible/original-text";
import { useOriginalVerse, type StrongsEntry } from "./useOriginalVerse";

interface OriginalLanguageSectionProps {
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
}

/**
 * Atkinson Hyperlegible (the app body face) carries no Hebrew or Greek
 * glyphs, so the original script falls back to whatever the platform ships.
 * Naming Noto explicitly picks up the good faces where they are installed.
 */
const SCRIPT_FONT = "system-ui, 'Segoe UI', 'Noto Sans Hebrew', 'Noto Sans', serif";

/** Marks a definition request that is still in flight. */
type DefinitionState = StrongsEntry | null | "loading";

/**
 * Original language block in the verse panel: the Hebrew (Westminster
 * Leningrad Codex) or Greek (Scrivener 1894 Textus Receptus) words behind the
 * verse, each clickable for its lemma, parsing and Strong's definition.
 * Mirrors the Android section in mobile/src/features/bible.
 */
const OriginalLanguageSection: React.FC<OriginalLanguageSectionProps> = ({
	book,
	chapter,
	verse,
}) => {
	const { data, loading, notFound, fetchStrongs } = useOriginalVerse({
		book,
		chapter,
		verse,
		enabled: true,
	});
	const [selected, setSelected] = useState<number | null>(null);
	const [definitions, setDefinitions] = useState<Record<string, DefinitionState>>({});

	// A new verse means a new word list, so the old selection and the
	// definitions shown under it no longer refer to anything on screen.
	useEffect(() => {
		setSelected(null);
		setDefinitions({});
	}, [book, chapter, verse]);

	const onWordClick = useCallback(
		(index: number, strongs: string) => {
			setSelected((current) => (current === index ? null : index));
			if (!strongs || definitions[strongs] !== undefined) return;
			// The request is started outside the state updater: React may run an
			// updater twice in development, and that would double the fetch.
			setDefinitions((current) => ({ ...current, [strongs]: "loading" }));
			void (async () => {
				const entry = await fetchStrongs(strongs);
				setDefinitions((next) => ({ ...next, [strongs]: entry }));
			})();
		},
		[definitions, fetchStrongs]
	);

	if (loading) {
		return (
			<div className="mb-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2.5">
				<p className="pb-2 text-metadata font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
					Original language
				</p>
				<div aria-label="Loading the original language" className="flex flex-wrap gap-2">
					<div className="h-7 w-24 animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15" />
					<div className="h-7 w-16 animate-pulse rounded-full border border-amber-500/20 dark:border-amber-400/20 bg-amber-500/15 dark:bg-amber-400/15 [animation-delay:150ms]" />
				</div>
			</div>
		);
	}

	// A verse the original-language versification does not carry, or any
	// failure fetching it, simply leaves the panel as it was.
	if (notFound || !data || data.words.length === 0) return null;

	const rtl = isRightToLeft(data.language);
	const selectedWord = selected === null ? undefined : data.words[selected];
	const selectedDefinition = selectedWord ? definitions[selectedWord.strongs] : undefined;

	return (
		<div className="mb-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2.5">
			<p className="text-metadata font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
				Original language
			</p>
			<p className="pb-2 text-metadata text-neutral-400 dark:text-neutral-500">
				{data.language} · {data.textName}
			</p>

			<div
				dir={rtl ? "rtl" : "ltr"}
				className="flex flex-wrap gap-1.5"
				style={{ fontFamily: SCRIPT_FONT }}
			>
				{data.words.map((word, index) => {
					const display = rtl ? stripCantillation(word.text) : word.text;
					const active = selected === index;
					return (
						<button
							key={`${word.strongs}-${index}`}
							type="button"
							aria-pressed={active}
							aria-label={`${word.translit ?? word.text}, Strong's ${word.strongs}`}
							onClick={() => onWordClick(index, word.strongs)}
							className={`rounded-lg border px-2 py-1 leading-snug transition-colors ${
								rtl ? "text-xl" : "text-lg"
							} ${
								active
									? "border-amber-500/50 dark:border-amber-400/40 bg-amber-500/10 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300"
									: "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.06]"
							}`}
						>
							{display}
						</button>
					);
				})}
			</div>

			{selectedWord && (
				<div className="mt-2.5 rounded-lg border border-amber-500/30 dark:border-amber-400/25 bg-amber-500/[0.06] dark:bg-amber-400/[0.06] px-3 py-2.5">
					{selectedWord.lemma && (
						<p
							dir={rtl ? "rtl" : "ltr"}
							className="text-xl leading-snug text-neutral-800 dark:text-neutral-100"
							style={{ fontFamily: SCRIPT_FONT }}
						>
							{rtl ? stripCantillation(selectedWord.lemma) : selectedWord.lemma}
						</p>
					)}
					{selectedWord.translit && (
						<p className="text-[14px] italic leading-5 text-neutral-600 dark:text-neutral-300">
							{selectedWord.translit}
						</p>
					)}
					<p className="pt-1 text-metadata text-neutral-500 dark:text-neutral-400">
						{selectedWord.strongs} · {selectedWord.morph}
					</p>
					{selectedWord.gloss && (
						<p className="pt-1.5 text-[13px] leading-[19px] text-neutral-700 dark:text-neutral-200">
							<span className="font-bold text-amber-600 dark:text-amber-400">KJV </span>
							{selectedWord.gloss}
						</p>
					)}
					{selectedDefinition === "loading" ? (
						<p className="pt-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">…</p>
					) : selectedDefinition ? (
						<p className="pt-1.5 text-[13px] leading-[19px] text-neutral-600 dark:text-neutral-300">
							{selectedDefinition.def}
						</p>
					) : null}
				</div>
			)}
		</div>
	);
};

export default OriginalLanguageSection;

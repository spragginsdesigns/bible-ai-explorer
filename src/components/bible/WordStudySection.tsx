"use client";

import React, { useCallback, useEffect, useState } from "react";
import { isRightToLeft, stripCantillation } from "@/lib/bible/original-text";
import type { VerseWordDetail, VerseWordRow, VerseWordStudy } from "@/lib/verse-words-contract";
import { useVerseWords, type StrongsDetail } from "./useVerseWords";

interface WordStudySectionProps {
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
	/**
	 * Replaces the "Word by word" caption. The verse panel stacks one section
	 * per verse of a range, where "Verse 2" says more than repeating the same
	 * caption down the column.
	 */
	caption?: string;
	/**
	 * Opens chat with `prompt` already in the composer. `attach` pins the
	 * passage above it, which suits a question about this verse and not a
	 * concordance sweep across the whole Bible.
	 */
	onAsk: (prompt: string, attach: boolean) => void;
}

/**
 * Atkinson Hyperlegible (the app body face) carries no Hebrew or Greek
 * glyphs, so the original script falls back to whatever the platform ships.
 * Naming Noto explicitly picks up the good faces where they are installed.
 */
const SCRIPT_FONT = "system-ui, 'Segoe UI', 'Noto Sans Hebrew', 'Noto Sans', serif";

/** Marks a Strong's lookup that is still in flight. */
type StrongsState = StrongsDetail | null | "loading";

/** The Hebrew Bible runs to Malachi; everything after it is Greek. */
const LAST_HEBREW_BOOK = 39;

/** The head word of a row: the first one carrying a Strong's number. */
function headWordOf(study: VerseWordStudy, row: VerseWordRow): VerseWordDetail | undefined {
	for (const index of row.wordIndexes) {
		const word = study.words[index];
		if (word?.strongs) return word;
	}
	return row.wordIndexes.length > 0 ? study.words[row.wordIndexes[0]] : undefined;
}

/** The dictionary headword in its own script, without the cantillation marks. */
function lemmaOf(word: VerseWordDetail, rtl: boolean): string {
	const lemma = word.lemma ?? word.text;
	return rtl ? stripCantillation(lemma) : lemma;
}

const CHIP_CLASS =
	"rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12.5px] text-neutral-500 dark:bg-white/[0.07] dark:text-neutral-400";
const LABEL_CLASS =
	"text-metadata font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500";

/**
 * Words tab of the verse panel: every word of the original in reading order
 * beside the King James wording it became, each row openable for its Strong's
 * entry and the other verses that carry it, and under them a short study of
 * what the original says. Mirrors the Android section in
 * mobile/src/features/bible; the rows and the study come from
 * POST /api/verse-words, cached once per verse and shared by every reader.
 */
const WordStudySection: React.FC<WordStudySectionProps> = ({
	book,
	chapter,
	verse,
	caption = "Word by word",
	onAsk,
}) => {
	const { state, retry, fetchStrongs } = useVerseWords({ book, chapter, verse });
	const [openRow, setOpenRow] = useState<number | null>(null);
	const [entries, setEntries] = useState<Record<string, StrongsState>>({});

	// A new verse means new rows, so the open row no longer refers to anything
	// on screen. The entries are keyed by Strong's number and stay valid.
	useEffect(() => {
		setOpenRow(null);
	}, [book, chapter, verse]);

	const onRowClick = useCallback(
		(index: number, strongs: string | undefined) => {
			setOpenRow((current) => (current === index ? null : index));
			if (!strongs || entries[strongs] !== undefined) return;
			// The request starts outside the state updater: React may run an
			// updater twice in development, and that would double the fetch.
			setEntries((current) => ({ ...current, [strongs]: "loading" }));
			void (async () => {
				const entry = await fetchStrongs(strongs);
				setEntries((next) => ({ ...next, [strongs]: entry }));
			})();
		},
		[entries, fetchStrongs]
	);

	if (state.status === "loading") {
		const language = book <= LAST_HEBREW_BOOK ? "Hebrew" : "Greek";
		return (
			<div className="mb-2 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
				<p className={LABEL_CLASS}>{caption}</p>
				<div
					aria-label={`Reading the ${language}`}
					className="flex flex-col gap-1.5 pt-2"
				>
					{[0, 1, 2, 3].map((index) => (
						<div
							key={index}
							className="h-10 animate-pulse rounded-xl border border-amber-500/20 bg-amber-500/10 dark:border-amber-400/20 dark:bg-amber-400/10"
							style={{ animationDelay: `${index * 120}ms` }}
						/>
					))}
				</div>
				<p role="status" className="pt-2 text-[12.5px] text-neutral-500 dark:text-neutral-400">
					{`Reading the ${language}…`}
				</p>
			</div>
		);
	}

	// The original-language versification does not line up with the KJV
	// everywhere, so a verse with no Hebrew or Greek behind it is an expected
	// answer and says so in one quiet line.
	if (state.status === "not-found") {
		return (
			<div className="mb-2 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
				<p className={LABEL_CLASS}>{caption}</p>
				<p className="pt-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
					No original-language text for this verse.
				</p>
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="mb-2 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
				<p className={LABEL_CLASS}>{caption}</p>
				<div className="flex items-center gap-3 pt-1.5">
					<p className="flex-1 text-[13px] leading-[19px] text-neutral-500 dark:text-neutral-400">
						{state.message}
					</p>
					{state.retryable && (
						<button
							type="button"
							onClick={retry}
							className="text-[13px] font-semibold text-amber-600 dark:text-amber-400"
						>
							Retry
						</button>
					)}
				</div>
			</div>
		);
	}

	const { study } = state;
	const rtl = isRightToLeft(study.language);

	return (
		<div className="mb-2">
			<p className={LABEL_CLASS}>{caption}</p>
			<p className="pb-2 text-[12.5px] text-neutral-400 dark:text-neutral-500">
				{`${study.language} · ${study.textName} · in reading order`}
			</p>

			<div className="flex flex-col gap-1.5">
				{study.rows.map((row, index) => {
					const open = openRow === index;
					const head = headWordOf(study, row);
					const entry = head?.strongs ? entries[head.strongs] : undefined;
					return (
						<React.Fragment key={`${index}-${row.kjv}`}>
							<button
								type="button"
								aria-expanded={open}
								onClick={() => onRowClick(index, head?.strongs)}
								className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border px-3 py-2 text-left transition-colors ${
									open
										? "border-amber-500/40 bg-amber-500/10 dark:border-amber-400/30 dark:bg-amber-400/10"
										: "border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
								}`}
							>
								<span className="min-w-0">
									<span
										className={`font-[family-name:var(--font-cormorant)] text-[18px] font-semibold leading-tight ${
											open
												? "text-amber-700 dark:text-amber-300"
												: "text-neutral-800 dark:text-neutral-100"
										}`}
									>
										{row.kjv}
									</span>
									{row.translit && (
										<span className="ml-1.5 text-[11.5px] italic text-neutral-400 dark:text-neutral-500">
											{row.translit}
										</span>
									)}
									{row.sense && (
										<span className="mt-0.5 block text-[12.5px] leading-[17px] text-neutral-500 dark:text-neutral-400">
											{row.sense}
										</span>
									)}
								</span>
								<span
									dir={rtl ? "rtl" : "ltr"}
									className={`text-[21px] leading-tight text-neutral-700 dark:text-neutral-200 ${
										rtl ? "text-right" : "text-left"
									}`}
									style={{ fontFamily: SCRIPT_FONT }}
								>
									{rtl ? stripCantillation(row.original) : row.original}
								</span>
							</button>

							{open && head && (
								<WordDetail
									study={study}
									row={row}
									head={head}
									entry={entry}
									rtl={rtl}
									onAsk={onAsk}
								/>
							)}
						</React.Fragment>
					);
				})}
			</div>

			{study.study.length > 0 ? (
			<>
			<p className={`${LABEL_CLASS} pt-4`}>What the original says</p>
			<div className="pt-1.5">
				{study.study.map((paragraph, index) => (
					<p
						key={index}
						className="pb-2 text-[14.5px] leading-[22px] text-neutral-700 dark:text-neutral-200"
					>
						{paragraph}
					</p>
				))}
			</div>
			</>
			) : null}
			{study.carry && (
				<div className="rounded-r-lg border-l-2 border-amber-500 bg-black/[0.03] px-3 py-2 text-[13.5px] leading-5 text-neutral-700 dark:border-amber-400 dark:bg-white/[0.03] dark:text-neutral-200">
					<span className="font-bold text-amber-600 dark:text-amber-400">Carry this. </span>
					{study.carry}
				</div>
			)}

			<p className="pt-3 text-[11.5px] text-neutral-400/80 dark:text-neutral-600">
				{`Grounded in the ${study.textName} and Strong's · Tap a word for more`}
			</p>
		</div>
	);
};

interface WordDetailProps {
	study: VerseWordStudy;
	row: VerseWordRow;
	head: VerseWordDetail;
	entry: StrongsState | undefined;
	rtl: boolean;
	onAsk: (prompt: string, attach: boolean) => void;
}

/**
 * The open row's card: the head word's Strong's entry, its grammar in plain
 * words, three other KJV verses carrying the same number, and the two ways
 * deeper. A row can bind several words (a construct chain, a preposition
 * fused to its noun), so every word with a number gets its own grammar line
 * while the lookup follows the head word.
 */
const WordDetail: React.FC<WordDetailProps> = ({ study, row, head, entry, rtl, onAsk }) => {
	const lemma = lemmaOf(head, rtl);
	const loading = entry === "loading";
	const detail = entry && entry !== "loading" ? entry : null;
	const definition = detail?.def ?? head.gloss ?? null;
	const occurrences = detail?.occurrences;
	const grammarLines = row.wordIndexes
		.map((index) => study.words[index])
		.filter((word): word is VerseWordDetail => Boolean(word?.strongs));

	// A row always has a Strong's number to name; the reader's transliteration
	// is the model's, so it is only quoted when there is one.
	const translit = row.translit || head.translit || "";
	const naming = translit ? `${translit}, ${head.strongs}` : head.strongs;
	const askPrompt = `What does the ${study.language} word ${lemma} (${naming}) carry in this verse?`;
	const everyPrompt = `Show me every verse where the ${study.language} word ${lemma} (${head.strongs}) appears.`;

	return (
		<div className="rounded-xl border border-amber-500/30 bg-black/[0.04] px-3.5 py-3 dark:border-amber-400/25 dark:bg-white/[0.05]">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-[family-name:var(--font-cormorant)] text-[20px] italic text-amber-600 dark:text-amber-400">
					{translit}
				</span>
				<span
					dir={rtl ? "rtl" : "ltr"}
					className="text-[28px] leading-tight text-neutral-800 dark:text-neutral-100"
					style={{ fontFamily: SCRIPT_FONT }}
				>
					{lemma}
				</span>
			</div>

			{grammarLines.map((word, index) => (
				<p
					key={`${word.strongs}-${index}`}
					className="pt-1 text-[12.5px] text-neutral-500 dark:text-neutral-400"
				>
					{word.grammar ? `${word.strongs} · ${word.grammar.summary}` : word.strongs}
				</p>
			))}

			{head.grammar && head.grammar.features.length > 0 && (
				<div className="flex flex-wrap gap-1 pt-2">
					{head.grammar.features.map((feature) => (
						<span key={feature} className={CHIP_CLASS}>
							{feature}
						</span>
					))}
				</div>
			)}

			<div className="pt-2.5">
				<p className={LABEL_CLASS}>{"Strong's"}</p>
				{loading && !definition ? (
					<div
						aria-label="Loading the dictionary entry"
						className="mt-1.5 h-3 w-4/5 animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
					/>
				) : definition ? (
					<p className="pt-0.5 text-[13.5px] leading-5 text-neutral-700 dark:text-neutral-200">
						{definition}
					</p>
				) : null}
			</div>

			{(loading || (occurrences && occurrences.examples.length > 0)) && (
				<div className="pt-2.5">
					<p className={LABEL_CLASS}>Elsewhere in the KJV</p>
					{loading ? (
						<div className="flex flex-col gap-1.5 pt-1.5">
							<div className="h-3 w-full animate-pulse rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
							<div className="h-3 w-[88%] animate-pulse rounded-full bg-black/[0.06] [animation-delay:150ms] dark:bg-white/[0.08]" />
						</div>
					) : (
						<ul className="flex flex-col gap-1.5 pt-1">
							{occurrences?.examples.slice(0, 3).map((example) => (
								<li
									key={example.reference}
									className="grid grid-cols-[auto_1fr] items-baseline gap-x-2.5"
								>
									<span className="whitespace-nowrap text-[12.5px] font-bold text-amber-600 dark:text-amber-400">
										{example.reference}
									</span>
									<span className="line-clamp-2 font-[family-name:var(--font-cormorant)] text-[15px] leading-5 text-neutral-600 dark:text-neutral-300">
										{example.text}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			<div className="grid grid-cols-2 gap-2 pt-3">
				<button
					type="button"
					onClick={() => onAsk(askPrompt, true)}
					className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-[13px] font-bold text-amber-600 transition-colors hover:bg-amber-500/20 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400 dark:hover:bg-amber-400/20"
				>
					Ask about this word
				</button>
				{head.strongs ? (
					<button
						type="button"
						onClick={() => onAsk(everyPrompt, false)}
						className="rounded-lg border border-black/[0.1] bg-black/[0.04] px-2 py-2 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-black/[0.08] dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
					>
						{occurrences ? `Every verse · ${occurrences.total}` : "Every verse"}
					</button>
				) : null}
			</div>
		</div>
	);
};

export default WordStudySection;

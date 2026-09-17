import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text as ScriptText, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { AccentButton, GhostButton } from "@/components/ui";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { GetToken } from "@/lib/api";
import { SkeletonBar, useSkeletonPulse } from "./VerseInsightSection";
import { isRightToLeft } from "./originalText";
import {
	useVerseWords,
	type StrongsEntry,
	type VerseWordDetail,
	type VerseWordRow,
	type VerseWordStudy,
} from "./useVerseWords";

/** The last Old Testament book in canonical order; everything after it is Greek. */
const LAST_HEBREW_BOOK = 39;

/** Widths of the four skeleton rows, as percentages, while the study is written. */
const SKELETON_WIDTHS = [100, 88, 94, 72] as const;

export interface WordStudySectionProps {
	getToken: GetToken;
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	/** Null while the sheet is closed, which disables every request. */
	verse: number | null;
	/**
	 * Replaces the "WORD BY WORD" heading. The study view stacks one section
	 * per selected verse, so each is captioned by its verse number instead of
	 * repeating the tab's own name.
	 */
	caption?: string;
	/**
	 * Opens chat with `prompt` prefilled. `attach` also pins the verse above
	 * the composer: true for a question about this verse, false for a search
	 * across the whole Bible, where the verse would only narrow the answer.
	 */
	onAsk: (prompt: string, attach: boolean) => void;
}

/** The head word of a row is the first one carrying a Strong's number. */
function headWordOf(study: VerseWordStudy, row: VerseWordRow): VerseWordDetail | undefined {
	const words = row.wordIndexes
		.map((index) => study.words[index])
		.filter((word): word is VerseWordDetail => word !== undefined);
	return words.find((word) => word.strongs) ?? words[0];
}

function wordsOf(study: VerseWordStudy, row: VerseWordRow): VerseWordDetail[] {
	return row.wordIndexes
		.map((index) => study.words[index])
		.filter((word): word is VerseWordDetail => word !== undefined);
}

/**
 * "H5183 · a noun, feminine singular" for the expanded row. A multi-word row
 * leads with the word's own transliteration so each line says which word it
 * decodes; a single-word row matches the lemma already shown above it.
 */
function metaLine(word: VerseWordDetail, showTranslit: boolean): string {
	const parts: string[] = [];
	if (showTranslit && word.translit) parts.push(word.translit);
	if (word.strongs) parts.push(word.strongs);
	if (word.grammar?.summary) parts.push(word.grammar.summary);
	return parts.join(" · ");
}

function askPrompt(language: string, lemma: string, translit: string, strongs: string): string {
	const inner = [translit, strongs].filter((part) => part.length > 0).join(", ");
	const word = inner ? `${lemma} (${inner})` : lemma;
	return `What does the ${language} word ${word} carry in this verse?`;
}

function everyVersePrompt(language: string, lemma: string, strongs: string): string {
	return `Show me every verse where the ${language} word ${lemma} (${strongs}) appears.`;
}

/**
 * Words tab of the Tap-a-verse sheet: the verse laid out word by word against
 * the KJV wording it became, then a short study written from the verse's own
 * Strong's data and cached per verse on the server.
 *
 * Every original-script glyph is rendered with React Native's own Text, not
 * the app's AppText: AppText defaults to Atkinson Hyperlegible, which carries
 * no Hebrew or Greek glyphs, so an explicit app font would fall back badly
 * per-glyph. Leaving fontFamily unset hands the job to Android's system
 * fallback (Noto Sans Hebrew, Roboto for Greek), which covers both scripts.
 */
export function WordStudySection({
	getToken,
	book,
	chapter,
	verse,
	caption = "WORD BY WORD",
	onAsk,
}: WordStudySectionProps) {
	const styles = useThemedStyles(createStyles);
	const enabled = verse !== null;
	const { data, status, error, retry, fetchStrongs } = useVerseWords(getToken, {
		book,
		chapter,
		verse: verse ?? 0,
		enabled,
	});
	const pulse = useSkeletonPulse(status === "loading");

	const [openRow, setOpenRow] = useState<number | null>(null);
	const [entry, setEntry] = useState<StrongsEntry | null>(null);
	const [entryLoading, setEntryLoading] = useState(false);
	// Only the newest tap may write the entry, and nothing may write it after
	// unmount.
	const lookupIdRef = useRef(0);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// A new verse invalidates the open row and its lexicon entry outright.
	useEffect(() => {
		lookupIdRef.current += 1;
		setOpenRow(null);
		setEntry(null);
		setEntryLoading(false);
	}, [book, chapter, verse]);

	const onRowPress = useCallback(
		(index: number, strongs: string) => {
			const id = ++lookupIdRef.current;
			if (openRow === index) {
				setOpenRow(null);
				setEntry(null);
				setEntryLoading(false);
				return;
			}
			setOpenRow(index);
			setEntry(null);
			if (!strongs) {
				setEntryLoading(false);
				return;
			}
			setEntryLoading(true);
			void fetchStrongs(strongs).then((result) => {
				if (lookupIdRef.current !== id || !mountedRef.current) return;
				setEntry(result);
				setEntryLoading(false);
			});
		},
		[openRow, fetchStrongs]
	);

	const language = book <= LAST_HEBREW_BOOK ? "Hebrew" : "Greek";
	const rtl = data ? isRightToLeft(data.language) : language === "Hebrew";
	// The Greek text ships as the Textus Receptus, the Hebrew as the Westminster
	// Leningrad Codex; the footer names the one the reader is looking at.
	const sourceName = useMemo(
		() =>
			(data?.language ?? language) === "Hebrew"
				? "the Westminster Leningrad Codex"
				: "the Textus Receptus",
		[data?.language, language]
	);

	if (!enabled || status === "idle") return null;

	if (status === "not-found") {
		return (
			<View style={styles.container}>
				<Text style={styles.caption}>{caption}</Text>
				<Text style={styles.quietLine}>No original-language text for this verse.</Text>
			</View>
		);
	}

	if (status === "error") {
		return (
			<View style={styles.container}>
				<Text style={styles.caption}>{caption}</Text>
				<Text style={styles.quietLine}>{error}</Text>
				<Pressable accessibilityRole="button" onPress={retry} hitSlop={6}>
					<Text style={styles.retryLabel}>Retry</Text>
				</Pressable>
			</View>
		);
	}

	if (status === "loading" || !data) {
		return (
			<View style={styles.container}>
				<Text style={styles.caption}>{caption}</Text>
				<View accessibilityLabel="Building the word study" style={styles.skeleton}>
					{SKELETON_WIDTHS.map((width, index) => (
						<SkeletonBar
							key={width}
							width={width}
							pulse={pulse}
							delay={index * 0.18}
						/>
					))}
				</View>
				<Text style={styles.quietLine}>{`Reading the ${language}…`}</Text>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<Text style={styles.caption}>{caption}</Text>
			<Text style={styles.subtitle}>
				{`${data.language} · ${data.textName} · in reading order`}
			</Text>

			<View style={styles.rows}>
				{data.rows.map((row, index) => {
					const open = openRow === index;
					const head = headWordOf(data, row);
					const words = wordsOf(data, row);
					const lemma = head?.lemma ?? head?.text ?? row.original;
					const strongs = head?.strongs ?? "";
					const definition =
						entry?.def ??
						words
							.map((word) => word.gloss)
							.filter((gloss): gloss is string => Boolean(gloss))
							.join("; ");
					const examples = entry?.occurrences?.examples ?? [];
					const total = entry?.occurrences?.total;

					return (
						<React.Fragment key={`${index}:${row.kjv}`}>
							<Pressable
								accessibilityRole="button"
								accessibilityState={{ expanded: open }}
								accessibilityLabel={`${row.kjv}, ${row.translit}`}
								onPress={() => onRowPress(index, strongs)}
								style={[styles.row, open && styles.rowOpen]}
							>
								<View style={styles.rowLeft}>
									<Text style={[styles.rowKjv, open && styles.rowKjvOpen]}>
										{row.kjv}
										{row.translit ? (
											<Text style={styles.rowTranslit}>{`  ${row.translit}`}</Text>
										) : null}
									</Text>
									<Text style={styles.rowSense}>{row.sense}</Text>
								</View>
								<ScriptText style={[styles.rowOriginal, rtl && styles.rtlText]}>
									{row.original}
								</ScriptText>
							</Pressable>

							{open ? (
								<View style={styles.detail}>
									<View style={styles.detailTop}>
										<Text style={styles.detailTranslit}>{row.translit}</Text>
										<ScriptText
											style={[styles.detailLemma, rtl && styles.rtlText]}
										>
											{lemma}
										</ScriptText>
									</View>

									{words.map((word, wordIndex) => {
										const meta = metaLine(word, words.length > 1);
										const features = word.grammar?.features ?? [];
										if (!meta && features.length === 0) return null;
										return (
											<View
												key={`${wordIndex}:${word.strongs}:${word.morph}`}
												style={styles.wordBlock}
											>
												{meta ? (
													<Text style={styles.detailMeta}>{meta}</Text>
												) : null}
												{features.length > 0 ? (
													<View style={styles.chips}>
														{features.map((feature) => (
															<Text
																key={`${wordIndex}:${feature}`}
																style={styles.chip}
															>
																{feature}
															</Text>
														))}
													</View>
												) : null}
											</View>
										);
									})}

									{entryLoading || definition ? (
										<View style={styles.detailBlock}>
											<Text style={styles.detailLabel}>STRONG&apos;S</Text>
											<Text style={styles.detailBody}>
												{entryLoading && !definition ? "…" : definition}
											</Text>
										</View>
									) : null}

									{entryLoading || examples.length > 0 ? (
										<View style={styles.detailBlock}>
											<Text style={styles.detailLabel}>
												ELSEWHERE IN THE KJV
											</Text>
											{entryLoading && examples.length === 0 ? (
												<Text style={styles.detailBody}>…</Text>
											) : (
												examples.map((example) => (
													<View
														key={example.reference}
														style={styles.example}
													>
														<Text style={styles.exampleRef}>
															{example.reference}
														</Text>
														<Text
															numberOfLines={2}
															style={styles.exampleText}
														>
															{example.text}
														</Text>
													</View>
												))
											)}
										</View>
									) : null}

									<View style={styles.actions}>
										<AccentButton
											style={styles.actionButton}
											label="Ask about this word"
											onPress={() =>
												onAsk(
													askPrompt(
														data.language,
														lemma,
														row.translit,
														strongs
													),
													true
												)
											}
										/>
										{strongs ? (
											<GhostButton
												style={[styles.actionButton, styles.actionButtonSecondary]}
												label={
													total === undefined
														? "Every verse"
														: `Every verse · ${total}`
												}
												onPress={() =>
													onAsk(
														everyVersePrompt(
															data.language,
															lemma,
															strongs
														),
														false
													)
												}
											/>
										) : null}
									</View>
								</View>
							) : null}
						</React.Fragment>
					);
				})}
			</View>

			{data.study.length > 0 ? (
				<>
					<Text style={[styles.caption, styles.proseCaption]}>WHAT THE ORIGINAL SAYS</Text>
					{data.study.map((paragraph) => (
						<Text key={paragraph.slice(0, 40)} style={styles.paragraph}>
							{paragraph}
						</Text>
					))}
				</>
			) : null}

			{data.carry ? (
				<View style={styles.carry}>
					<Text style={styles.carryText}>
						<Text style={styles.carryLead}>Carry this. </Text>
						{data.carry}
					</Text>
				</View>
			) : null}

			<Text style={styles.footer}>
				{`Grounded in ${sourceName} and Strong's · Tap a word for more`}
			</Text>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: { marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
		caption: {
			color: c.textMuted,
			...typography.support,
			fontWeight: "700",
			textTransform: "uppercase",
			letterSpacing: 0.8,
		},
		proseCaption: { marginTop: spacing.lg },
		subtitle: { color: c.textFaint, ...typography.meta, marginBottom: spacing.sm },
		quietLine: { color: c.textMuted, ...typography.meta, marginTop: spacing.xs },
		retryLabel: {
			color: c.accent,
			...typography.meta,
			fontWeight: "600",
			marginTop: spacing.sm,
		},
		skeleton: { gap: spacing.sm, marginTop: spacing.md },

		rows: { gap: 6 },
		row: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: 9,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			backgroundColor: c.surface,
		},
		rowOpen: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		rowLeft: { flex: 1 },
		rowKjv: { color: c.text, fontFamily: fonts.verse, fontSize: 18, lineHeight: 22 },
		rowKjvOpen: { color: c.accent },
		rowTranslit: { color: c.textFaint, fontSize: 11.5, fontStyle: "italic" },
		rowSense: { color: c.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
		// The script column keeps the KJV column readable by never taking more
		// than its share of a narrow phone.
		rowOriginal: { color: c.text, fontSize: 21, lineHeight: 30, maxWidth: "42%" },
		rtlText: { writingDirection: "rtl", textAlign: "right" },

		detail: {
			padding: spacing.lg,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
			backgroundColor: c.bgElevated,
			gap: spacing.sm,
		},
		detailTop: {
			flexDirection: "row",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: spacing.sm,
		},
		detailTranslit: {
			color: c.accent,
			fontFamily: fonts.verseItalic,
			fontStyle: "italic",
			fontSize: 20,
			lineHeight: 26,
			flexShrink: 1,
		},
		detailLemma: { color: c.text, fontSize: 28, lineHeight: 38 },
		wordBlock: { gap: spacing.xs },
		detailMeta: { color: c.textMuted, ...typography.meta },
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
		chip: {
			color: c.textMuted,
			...typography.micro,
			backgroundColor: c.surfaceStrong,
			borderRadius: radius.sm,
			paddingHorizontal: 7,
			paddingVertical: 2,
			overflow: "hidden",
		},
		detailBlock: { gap: 2 },
		detailLabel: {
			color: c.textFaint,
			...typography.micro,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 0.8,
		},
		detailBody: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },
		example: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
		exampleRef: { color: c.accentDim, ...typography.micro, fontWeight: "700" },
		exampleText: {
			color: c.textSecondary,
			fontFamily: fonts.verse,
			fontSize: 15,
			lineHeight: 20,
			flex: 1,
		},
		actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
		// The question is the longer label; give it the room so neither wraps.
		actionButton: { flex: 3, minHeight: 40, paddingHorizontal: spacing.sm },
		actionButtonSecondary: { flex: 2 },

		paragraph: {
			color: c.textSecondary,
			fontSize: 14.5,
			lineHeight: 22,
			marginTop: spacing.sm,
		},
		carry: {
			marginTop: spacing.md,
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
			borderLeftWidth: 2,
			borderLeftColor: c.accent,
			borderTopRightRadius: radius.sm,
			borderBottomRightRadius: radius.sm,
			backgroundColor: c.surface,
		},
		carryText: { color: c.textSecondary, fontSize: 13.5, lineHeight: 20 },
		carryLead: { color: c.accent, fontWeight: "700" },
		footer: { color: c.textGhost, ...typography.micro, marginTop: spacing.md },
	});

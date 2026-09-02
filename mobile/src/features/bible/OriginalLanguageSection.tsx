import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text as ScriptText, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { GetToken } from "@/lib/api";
import { isRightToLeft, stripCantillation } from "./originalText";
import { useOriginalVerse, type OriginalWord } from "./useOriginalVerse";

/**
 * Hebrew needs a taller size than Greek to keep the vowel points legible; the
 * Greek diacritics survive a smaller body.
 */
const HEBREW_SIZE = 22;
const GREEK_SIZE = 20;

export interface OriginalLanguageSectionProps {
	getToken: GetToken;
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	/** Null while the sheet is closed, which disables every request. */
	verse: number | null;
}

/**
 * "Original language" block of the Tap-a-verse sheet: the Hebrew or Greek
 * words behind the verse, each tappable for its lemma, morphology and Strong's
 * definition.
 *
 * Every original-script glyph is rendered with React Native's own Text, not
 * the app's AppText: AppText defaults to Atkinson Hyperlegible, which carries
 * no Hebrew or Greek glyphs, so an explicit app font would fall back badly
 * per-glyph. Leaving fontFamily unset hands the job to Android's system
 * fallback (Noto Sans Hebrew, Roboto for Greek), which covers both scripts.
 */
export function OriginalLanguageSection({
	getToken,
	book,
	chapter,
	verse,
}: OriginalLanguageSectionProps) {
	const styles = useThemedStyles(createStyles);
	const enabled = verse !== null;
	const { data, loading, notFound, fetchStrongs } = useOriginalVerse(getToken, {
		book,
		chapter,
		verse: verse ?? 0,
		enabled,
	});

	const [selected, setSelected] = useState<number | null>(null);
	const [definition, setDefinition] = useState<string | null>(null);
	const [definitionLoading, setDefinitionLoading] = useState(false);
	// Only the newest tap may write the definition, and nothing may write it
	// after unmount.
	const lookupIdRef = useRef(0);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// A new verse invalidates the open word and its definition outright.
	useEffect(() => {
		lookupIdRef.current += 1;
		setSelected(null);
		setDefinition(null);
		setDefinitionLoading(false);
	}, [book, chapter, verse]);

	const onWordPress = useCallback(
		(index: number, word: OriginalWord) => {
			const id = ++lookupIdRef.current;
			if (selected === index) {
				setSelected(null);
				setDefinition(null);
				setDefinitionLoading(false);
				return;
			}
			setSelected(index);
			setDefinition(null);
			if (!word.strongs) {
				setDefinitionLoading(false);
				return;
			}
			setDefinitionLoading(true);
			void fetchStrongs(word.strongs).then((entry) => {
				if (lookupIdRef.current !== id || !mountedRef.current) return;
				setDefinition(entry?.def ?? null);
				setDefinitionLoading(false);
			});
		},
		[selected, fetchStrongs]
	);

	// Nothing to show, and nothing worth explaining: the sheet is complete
	// without this section, so a failure simply removes it.
	if (!enabled || notFound) return null;
	if (!loading && !data) return null;

	const rtl = data ? isRightToLeft(data.language) : false;
	const scriptSize = rtl ? HEBREW_SIZE : GREEK_SIZE;
	const selectedWord = data && selected !== null ? data.words[selected] : undefined;

	return (
		<View style={styles.container}>
			<Text style={styles.caption}>ORIGINAL LANGUAGE</Text>
			{data ? (
				<Text style={styles.subtitle}>{`${data.language} · ${data.textName}`}</Text>
			) : null}

			{loading ? (
				<View accessibilityLabel="Loading the original language" style={styles.wordRow}>
					<View style={[styles.skeletonPill, { width: 96 }]} />
					<View style={[styles.skeletonPill, { width: 64 }]} />
				</View>
			) : null}

			{data ? (
				<View style={[styles.wordRow, rtl && styles.wordRowRtl]}>
					{data.words.map((word, index) => (
						<Pressable
							key={`${index}:${word.strongs}`}
							accessibilityRole="button"
							accessibilityState={{ selected: selected === index }}
							accessibilityLabel={`${word.translit ?? word.text}, Strong's ${word.strongs}`}
							onPress={() => onWordPress(index, word)}
							style={[styles.word, selected === index && styles.wordSelected]}
						>
							<ScriptText
								style={[
									styles.wordText,
									{ fontSize: scriptSize },
									rtl && styles.rtlText,
								]}
							>
								{rtl ? stripCantillation(word.text) : word.text}
							</ScriptText>
						</Pressable>
					))}
				</View>
			) : null}

			{selectedWord ? (
				<View style={styles.detail}>
					<ScriptText style={[styles.detailLemma, rtl && styles.rtlText]}>
						{rtl
							? stripCantillation(selectedWord.lemma ?? selectedWord.text)
							: (selectedWord.lemma ?? selectedWord.text)}
					</ScriptText>
					{selectedWord.translit ? (
						<Text style={styles.detailTranslit}>{selectedWord.translit}</Text>
					) : null}
					<Text style={styles.detailMeta}>
						{`${selectedWord.strongs} · ${selectedWord.morph}`}
					</Text>
					{selectedWord.gloss ? (
						<Text style={styles.detailGloss}>
							<Text style={styles.detailGlossLabel}>KJV </Text>
							{selectedWord.gloss}
						</Text>
					) : null}
					{definitionLoading ? (
						<Text style={styles.detailDefinition}>…</Text>
					) : definition ? (
						<Text style={styles.detailDefinition}>{definition}</Text>
					) : null}
				</View>
			) : null}
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
		subtitle: { color: c.textFaint, ...typography.meta, marginBottom: spacing.sm },
		wordRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
		// Right-to-left reading order for Hebrew: the first word sits at the
		// right edge and wrapping continues leftward.
		wordRowRtl: { flexDirection: "row-reverse" },
		word: {
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: c.border,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.sm,
			paddingVertical: 4,
		},
		wordSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
		wordText: { color: c.text },
		rtlText: { writingDirection: "rtl", textAlign: "right" },
		skeletonPill: {
			height: 36,
			borderRadius: radius.sm,
			backgroundColor: c.accentSoft,
			borderWidth: 1,
			borderColor: c.accentBorder,
		},
		detail: {
			marginTop: spacing.sm,
			padding: spacing.md,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			gap: 4,
		},
		detailLemma: { color: c.text, fontSize: 20, lineHeight: 30 },
		detailTranslit: { color: c.textSecondary, ...typography.support, fontStyle: "italic" },
		detailMeta: { color: c.textMuted, ...typography.meta },
		detailGloss: { color: c.textSecondary, ...typography.support },
		detailGlossLabel: { color: c.accentDim, fontWeight: "700" },
		detailDefinition: { color: c.textMuted, ...typography.meta },
	});

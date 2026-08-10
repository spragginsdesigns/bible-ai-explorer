import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	Share,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { GlassCard, Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { saveVerseToNote } from "@/features/chat/verseActions";
import { BottomSheet, SheetRow } from "@/features/notes/components/primitives";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { bookByOrder, type Book } from "@/features/bible/books";
import { TRANSLATIONS, getChapter, type TranslationId } from "@/features/bible/translations";
import { colors, fonts, radius, spacing } from "@/theme";

const FONT_STEPS = [17, 20, 24, 28] as const;
/** Remembered for the whole app session, like the old reader's default. */
let sessionFontStep = 1;
/** Last translation picked, kept across screens for the session. */
let sessionTranslation: TranslationId = "KJV";

interface ActionVerse {
	number: number;
	text: string;
}

/**
 * Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), verse
 * long-press actions (copy/share/save/Ask AI), adjustable type size, and
 * prev/next navigation that rolls into adjacent books like YouVersion.
 */
export default function BibleChapterScreen() {
	const router = useRouter();
	const getToken = useStableGetToken();
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{ book?: string; chapter?: string; verse?: string }>();

	const [order, setOrder] = useState(() =>
		Number.parseInt(typeof params.book === "string" ? params.book : "1", 10)
	);
	const [chapter, setChapter] = useState(() =>
		Number.parseInt(typeof params.chapter === "string" ? params.chapter : "1", 10)
	);
	const targetVerse = useRef(
		Number.parseInt(typeof params.verse === "string" ? params.verse : "", 10) || null
	);

	const book: Book | null = bookByOrder(order);
	const [translation, setTranslationState] = useState<TranslationId>(sessionTranslation);
	const setTranslation = useCallback((id: TranslationId) => {
		sessionTranslation = id;
		setTranslationState(id);
	}, []);
	const [verses, setVerses] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [fontStep, setFontStep] = useState(sessionFontStep);
	const [highlighted, setHighlighted] = useState<number | null>(null);
	const [actionVerse, setActionVerse] = useState<ActionVerse | null>(null);
	const [copied, setCopied] = useState(false);
	const [saveBusy, setSaveBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const listRef = useRef<FlatList<string>>(null);
	const didScrollToTarget = useRef(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setVerses(await getChapter(translation, order, chapter));
		} catch (err) {
			setVerses([]);
			setError(err instanceof Error ? err.message : "That chapter could not be loaded.");
		} finally {
			setLoading(false);
		}
	}, [translation, order, chapter]);

	useEffect(() => {
		void load();
	}, [load]);

	// ?verse= deep link: scroll to the verse once the chapter is on screen and
	// flash it briefly so the eye lands there.
	useEffect(() => {
		if (loading || error || !verses.length || didScrollToTarget.current) return;
		const verse = targetVerse.current;
		if (!verse || verse < 1 || verse > verses.length) return;
		didScrollToTarget.current = true;
		const timer = setTimeout(() => {
			listRef.current?.scrollToIndex({ index: verse - 1, viewPosition: 0.15, animated: false });
			setHighlighted(verse);
			setTimeout(() => setHighlighted(null), 2400);
		}, 250);
		return () => clearTimeout(timer);
	}, [loading, error, verses]);

	const stepFont = useCallback((delta: number) => {
		setFontStep((step) => {
			const next = Math.min(FONT_STEPS.length - 1, Math.max(0, step + delta));
			sessionFontStep = next;
			return next;
		});
	}, []);

	const neighbors = useMemo(() => {
		const current = bookByOrder(order);
		if (!current) return { prev: null, next: null };
		const at = (o: number, c: number) => ({ order: o, chapter: c });
		const prevBook = bookByOrder(order - 1);
		const nextBook = bookByOrder(order + 1);
		return {
			prev:
				chapter > 1 ? at(order, chapter - 1) : prevBook ? at(prevBook.order, prevBook.chapters) : null,
			next:
				chapter < current.chapters ? at(order, chapter + 1) : nextBook ? at(nextBook.order, 1) : null,
		};
	}, [order, chapter]);

	const goTo = useCallback((target: { order: number; chapter: number } | null) => {
		if (!target) return;
		didScrollToTarget.current = true; // don't re-trigger the ?verse= scroll
		targetVerse.current = null;
		listRef.current?.scrollToOffset({ offset: 0, animated: false });
		setOrder(target.order);
		setChapter(target.chapter);
	}, []);

	const reference = book ? `${book.name} ${chapter}` : "";
	const actionReference = actionVerse ? `${reference}:${actionVerse.number}` : "";

	const closeSheet = useCallback(() => {
		setActionVerse(null);
		setCopied(false);
		setSaveError(null);
	}, []);

	const askAI = useCallback(
		(verse: { reference: string; text: string }) => {
			closeSheet();
			router.push({
				pathname: "/",
				params: {
					attachRef: verse.reference,
					attachText: verse.text,
					attachTranslation: translation,
				},
			});
		},
		[router, closeSheet, translation]
	);

	const onCopyVerse = useCallback(async () => {
		if (!actionVerse) return;
		await Clipboard.setStringAsync(
			`${actionReference} — "${actionVerse.text}" (${translation})`
		);
		setCopied(true);
		setTimeout(closeSheet, 600);
	}, [actionVerse, actionReference, translation, closeSheet]);

	const onShareVerse = useCallback(() => {
		if (!actionVerse) return;
		Share.share({
			message: `${actionReference} — "${actionVerse.text}" (${translation})`,
		}).catch(() => {});
		closeSheet();
	}, [actionVerse, actionReference, translation, closeSheet]);

	const onSaveVerse = useCallback(async () => {
		if (!actionVerse || saveBusy) return;
		setSaveBusy(true);
		setSaveError(null);
		try {
			const noteId = await saveVerseToNote(
				getToken,
				{
					reference: actionReference,
					text: actionVerse.text,
				},
				translation
			);
			closeSheet();
			router.push({ pathname: "/notes/[id]", params: { id: noteId } });
		} catch {
			setSaveError("The note could not be saved. Check your connection and try again.");
		} finally {
			setSaveBusy(false);
		}
	}, [actionVerse, actionReference, saveBusy, getToken, router, closeSheet]);

	const fontSize = FONT_STEPS[fontStep];
	const lineHeight = Math.round(fontSize * 1.55);

	if (!book) {
		return (
			<Screen>
				<View style={styles.topBar}>
					<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
						<Text style={styles.back}>‹ Back</Text>
					</Pressable>
				</View>
				<View style={styles.center}>
					<Text style={styles.loadingLabel}>That book could not be found.</Text>
				</View>
			</Screen>
		);
	}

	return (
		<Screen>
			<View style={styles.topBar}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					{reference}
				</Text>
				<View style={styles.fontControls}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Decrease text size"
						disabled={fontStep === 0}
						onPress={() => stepFont(-1)}
						style={[styles.fontButton, fontStep === 0 && { opacity: 0.35 }]}
					>
						<Text style={styles.fontButtonLabel}>A−</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Increase text size"
						disabled={fontStep === FONT_STEPS.length - 1}
						onPress={() => stepFont(1)}
						style={[styles.fontButton, fontStep === FONT_STEPS.length - 1 && { opacity: 0.35 }]}
					>
						<Text style={[styles.fontButtonLabel, { fontSize: 16 }]}>A+</Text>
					</Pressable>
				</View>
			</View>

			<View style={styles.translationRow}>
				{(Object.keys(TRANSLATIONS) as TranslationId[]).map((id) => (
					<Pressable
						key={id}
						accessibilityRole="button"
						accessibilityState={{ selected: translation === id }}
						onPress={() => setTranslation(id)}
						style={[styles.translationChip, translation === id && styles.translationChipActive]}
					>
						<Text
							style={[styles.translationChipLabel, translation === id && { color: colors.accent }]}
						>
							{id}
						</Text>
					</Pressable>
				))}
			</View>

			{loading ? (
				<View style={styles.center}>
					<ActivityIndicator color={colors.accent} />
					<Text style={styles.loadingLabel}>
						{translation === "NKJV" ? "Loading the NKJV…" : "Opening the chapter…"}
					</Text>
				</View>
			) : error ? (
				<View style={styles.center}>
					<GlassCard style={styles.errorCard}>
						<Text style={styles.errorText}>{error}</Text>
						<Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
							<Text style={styles.retryLabel}>Try again</Text>
						</Pressable>
					</GlassCard>
				</View>
			) : (
				<View style={styles.body}>
					<FlatList
						ref={listRef}
						data={verses}
						keyExtractor={(_, index) => String(index + 1)}
						contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 96 }]}
						onScrollToIndexFailed={({ index }) => {
							// Rows have variable height; approximate, then retry once laid out.
							listRef.current?.scrollToOffset({ offset: index * 48, animated: false });
							setTimeout(
								() => listRef.current?.scrollToIndex({ index, viewPosition: 0.15, animated: false }),
								250
							);
						}}
						ListFooterComponent={
							<View>
								<Text style={styles.copyright}>
									{TRANSLATIONS[translation].label} — {TRANSLATIONS[translation].copyright}
								</Text>
								<View style={styles.navRow}>
									<Pressable
										accessibilityRole="button"
										disabled={!neighbors.prev}
										onPress={() => goTo(neighbors.prev)}
										style={[styles.navChip, !neighbors.prev && { opacity: 0.35 }]}
									>
										<Text style={styles.navChipLabel}>‹ Previous</Text>
									</Pressable>
									<Pressable
										accessibilityRole="button"
										disabled={!neighbors.next}
										onPress={() => goTo(neighbors.next)}
										style={[styles.navChip, styles.navChipAccent, !neighbors.next && { opacity: 0.35 }]}
									>
										<Text style={[styles.navChipLabel, { color: colors.accent }]}>Next ›</Text>
									</Pressable>
								</View>
							</View>
						}
						renderItem={({ item, index }) => {
							const verseNumber = index + 1;
							return (
								<Pressable
									accessibilityRole="button"
									delayLongPress={300}
									onLongPress={() => setActionVerse({ number: verseNumber, text: item })}
									style={[
										styles.verseRow,
										highlighted === verseNumber && styles.verseRowHighlighted,
									]}
								>
									<Text style={[styles.verseText, { fontSize, lineHeight }]}>
										<Text style={styles.verseNumber}>{verseNumber} </Text>
										{item}
									</Text>
								</Pressable>
							);
						}}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Ask AI about ${reference}`}
						onPress={() =>
							askAI({
								reference,
								text: verses.map((t, i) => `${i + 1} ${t}`).join("\n"),
							})
						}
						style={({ pressed }) => [
							styles.askButton,
							{ bottom: tabBarSpace + spacing.lg },
							pressed && { backgroundColor: colors.accentPressed },
						]}
					>
						<Text style={styles.askButtonLabel}>✦ Ask AI</Text>
					</Pressable>
				</View>
			)}

			<BottomSheet visible={actionVerse !== null} onClose={closeSheet} title={actionReference}>
				<SheetRow
					glyph="⧉"
					label={copied ? "Copied ✓" : "Copy"}
					onPress={() => void onCopyVerse()}
				/>
				<SheetRow glyph="↗" label="Share" onPress={onShareVerse} />
				<SheetRow
					glyph="✎"
					label={saveBusy ? "Saving…" : "Save to note"}
					onPress={() => void onSaveVerse()}
				/>
				<SheetRow
					glyph="✦"
					label="Ask AI about this verse"
					onPress={() => {
						if (actionVerse) askAI({ reference: actionReference, text: actionVerse.text });
					}}
				/>
				{saveError ? <Text style={styles.sheetError}>{saveError}</Text> : null}
			</BottomSheet>
		</Screen>
	);
}

const styles = StyleSheet.create({
	topBar: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
	},
	back: { color: colors.accent, fontSize: 15, fontWeight: "600" },
	title: {
		flex: 1,
		color: colors.text,
		fontSize: 15,
		fontWeight: "600",
		textAlign: "center",
	},
	fontControls: { flexDirection: "row", gap: spacing.sm },
	translationRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		gap: 4,
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.sm,
	},
	translationChip: {
		borderRadius: radius.full,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
	},
	translationChipActive: {
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	translationChipLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
	loadingLabel: { marginTop: spacing.md, color: colors.textFaint, fontSize: 13 },
	errorCard: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
	errorText: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
	retry: {
		borderRadius: radius.md,
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
		borderWidth: 1,
		paddingHorizontal: spacing.xl,
		paddingVertical: spacing.sm,
	},
	retryLabel: { color: colors.accent, fontSize: 14, fontWeight: "600" },
	body: { flex: 1 },
	content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
	verseRow: { borderRadius: radius.md, paddingHorizontal: spacing.xs },
	verseRowHighlighted: { backgroundColor: colors.accentSoft },
	verseText: {
		color: colors.textSecondary,
		fontFamily: fonts.verse,
		marginBottom: spacing.md,
	},
	verseNumber: { color: colors.accentDim, fontSize: 12, fontFamily: fonts.sans, fontWeight: "700" },
	copyright: {
		marginTop: spacing.lg,
		color: colors.textGhost,
		fontSize: 12,
		textAlign: "center",
		fontStyle: "italic",
	},
	navRow: {
		flexDirection: "row",
		gap: spacing.md,
		marginTop: spacing.xl,
	},
	navChip: {
		flex: 1,
		minHeight: 44,
		borderRadius: radius.lg,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		alignItems: "center",
		justifyContent: "center",
	},
	navChipAccent: {
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	navChipLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
	askButton: {
		position: "absolute",
		right: spacing.xl,
		borderRadius: radius.full,
		borderWidth: 1,
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
		paddingHorizontal: spacing.xl,
		paddingVertical: spacing.md,
	},
	askButtonLabel: { color: colors.accent, fontSize: 14, fontWeight: "700" },
	sheetError: {
		color: colors.danger,
		fontSize: 12.5,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.md,
	},
	fontButton: {
		borderRadius: radius.md,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.surface,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
	},
	fontButtonLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
});

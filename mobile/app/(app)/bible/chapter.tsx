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
import { fonts, radius, spacing, type Colors } from "@/theme";
import {
	setBibleTranslation,
	useSettings,
	useThemedStyles,
	useTheme,
} from "@/features/settings/settingsStore";

const FONT_STEPS = [17, 20, 24, 28] as const;
const HIGHLIGHT_MS = 2400;
/** Remembered for the whole app session, like the old reader's default. */
let sessionFontStep = 1;

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
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const params = useLocalSearchParams<{ book?: string; chapter?: string; verse?: string }>();

	// The params ARE what the reader shows — they must never be copied into
	// state. `bible` is a nested stack that keeps this screen mounted, so a
	// second deep link from chat reuses the instance and only updates the
	// params; anything seeded once at mount would keep rendering the first
	// chapter forever. Mirrors src/components/bible/ChapterReader.tsx on web.
	const order = Number.parseInt(typeof params.book === "string" ? params.book : "1", 10);
	const chapter = Number.parseInt(typeof params.chapter === "string" ? params.chapter : "1", 10);
	const verseParam =
		Number.parseInt(typeof params.verse === "string" ? params.verse : "", 10) || null;

	const book: Book | null = bookByOrder(order);
	// The reader's translation chips and Settings share one persisted default.
	const translation = useSettings().translation;
	const setTranslation = setBibleTranslation;
	const [verses, setVerses] = useState<string[]>([]);
	// Which chapter `verses` actually holds. Params change a render before the
	// new text arrives, so without this the effects below would run once against
	// the previous chapter's verses while `order`/`chapter` already point at the
	// new one.
	const [loadedKey, setLoadedKey] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [fontStep, setFontStep] = useState(sessionFontStep);
	const [highlighted, setHighlighted] = useState<number | null>(null);
	const [actionVerse, setActionVerse] = useState<ActionVerse | null>(null);
	const [copied, setCopied] = useState(false);
	const [saveBusy, setSaveBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const listRef = useRef<FlatList<string>>(null);
	const lastFlashed = useRef<string | null>(null);
	const requestId = useRef(0);

	const chapterKey = `${translation}:${order}:${chapter}`;

	const load = useCallback(async () => {
		// Paging quickly, or deep-linking while a fetch is in flight, can leave
		// two loads racing; only the newest may write. NKJV comes over the network,
		// so the slower one is not always the older one.
		const id = ++requestId.current;
		const key = `${translation}:${order}:${chapter}`;
		setLoading(true);
		setError(null);
		try {
			const next = await getChapter(translation, order, chapter);
			if (requestId.current !== id) return;
			setVerses(next);
			setLoadedKey(key);
		} catch (err) {
			if (requestId.current !== id) return;
			setVerses([]);
			setLoadedKey(null);
			setError(err instanceof Error ? err.message : "That chapter could not be loaded.");
		} finally {
			if (requestId.current === id) setLoading(false);
		}
	}, [translation, order, chapter]);

	useEffect(() => {
		void load();
	}, [load]);

	// A newly opened chapter starts at the top; the ?verse= effect below scrolls
	// on from there. Needed because the reused screen keeps the previous
	// chapter's scroll offset.
	useEffect(() => {
		listRef.current?.scrollToOffset({ offset: 0, animated: false });
	}, [translation, order, chapter]);

	// ?verse= deep link: scroll to the verse once the chapter is on screen and
	// flash it briefly so the eye lands there. Guarded by the reference it last
	// flashed rather than a one-shot flag, so every new deep link re-arms it —
	// and gated on loadedKey, or the stale-verses render would burn that guard
	// on the incoming reference before its text was ever on screen.
	useEffect(() => {
		if (loading || error || loadedKey !== chapterKey || !verses.length) return;
		if (!verseParam || verseParam < 1 || verseParam > verses.length) return;
		const flashKey = `${chapterKey}:${verseParam}`;
		if (lastFlashed.current === flashKey) return;
		lastFlashed.current = flashKey;
		const scrollTimer = setTimeout(() => {
			listRef.current?.scrollToIndex({
				index: verseParam - 1,
				viewPosition: 0.15,
				animated: false,
			});
			setHighlighted(verseParam);
		}, 250);
		const clearTimer = setTimeout(() => setHighlighted(null), 250 + HIGHLIGHT_MS);
		return () => {
			clearTimeout(scrollTimer);
			clearTimeout(clearTimer);
		};
	}, [loading, error, loadedKey, chapterKey, verses, verseParam]);

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

	const goTo = useCallback(
		(target: { order: number; chapter: number } | null) => {
			if (!target) return;
			// setParams rather than local state, so params stay the one description
			// of what is on screen. Clearing ?verse= stops the flash effect from
			// firing again in the chapter we just paged into, and forgetting the
			// last flash lets a later deep link back to that same verse re-flash it.
			lastFlashed.current = null;
			router.setParams({
				book: String(target.order),
				chapter: String(target.chapter),
				verse: "",
			});
		},
		[router]
	);

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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		topBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: {
			flex: 1,
			color: c.text,
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
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.sm,
			paddingVertical: 4,
		},
		translationChipActive: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		translationChipLabel: { color: c.textMuted, fontSize: 11, fontWeight: "700" },
		center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
		loadingLabel: { marginTop: spacing.md, color: c.textFaint, fontSize: 13 },
		errorCard: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
		errorText: { color: c.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
		retry: {
			borderRadius: radius.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			paddingHorizontal: spacing.xl,
			paddingVertical: spacing.sm,
		},
		retryLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		body: { flex: 1 },
		content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
		verseRow: { borderRadius: radius.md, paddingHorizontal: spacing.xs },
		verseRowHighlighted: { backgroundColor: c.accentSoft },
		verseText: {
			color: c.textSecondary,
			fontFamily: fonts.verse,
			marginBottom: spacing.md,
		},
		verseNumber: { color: c.accentDim, fontSize: 12, fontFamily: fonts.sans, fontWeight: "700" },
		copyright: {
			marginTop: spacing.lg,
			color: c.textGhost,
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
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			alignItems: "center",
			justifyContent: "center",
		},
		navChipAccent: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		navChipLabel: { color: c.textSecondary, fontSize: 14, fontWeight: "600" },
		askButton: {
			position: "absolute",
			right: spacing.xl,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			paddingHorizontal: spacing.xl,
			paddingVertical: spacing.md,
		},
		askButtonLabel: { color: c.accent, fontSize: 14, fontWeight: "700" },
		sheetError: {
			color: c.danger,
			fontSize: 12.5,
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.md,
		},
		fontButton: {
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			paddingHorizontal: spacing.sm,
			paddingVertical: 4,
		},
		fontButtonLabel: { color: c.textSecondary, fontSize: 12, fontWeight: "700" },
	});

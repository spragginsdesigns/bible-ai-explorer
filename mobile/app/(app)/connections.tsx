import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Screen } from "@/components/ui";
import { HelpButton, SettingsButton } from "@/features/navigation/HubChrome";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder, resolveReference } from "@/features/bible/books";
import {
	CONNECTION_SECTIONS,
	connectionSectionOf,
	sectionInk,
	connectionsAskPrompt,
	sectionCounts,
	type ChapterLink,
} from "@/features/bible/connectionsMap";
import { getChapter, TRANSLATIONS } from "@/features/bible/translations";
import { bibleVersePlainText } from "@/features/bible/verseMarkup";
import { ConnectionsRing } from "@/features/connections/ConnectionsRing";
import { ExplainSheet } from "@/features/connections/ExplainSheet";
import {
	loadChapterConnections,
	loadConnectionsOverview,
	loadLinkedQuotes,
	quoteFor,
	type ChapterConnections,
	type ConnectionsOverview,
} from "@/features/connections/connectionsData";
import { useConnectionsExplain } from "@/features/connections/useConnectionsExplain";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useSettingsSelector, useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";

// A render crash shows a Try again screen in place of this route instead of closing the app.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

/** Where the tab opens before the reader has sent it anywhere: John 3:16. */
const DEFAULT_PLACE = { order: 43, chapter: 3, verse: 16 as number | null };

type Place = { order: number; chapter: number; verse: number | null };

// Stable empties, so the memoized ring does not redraw while a chapter loads.
const NO_LINKS: ChapterLink[] = [];
const NO_TEXTS: string[] = [];

function textsKey(order: number, chapter: number, translation: string): string {
	return `${order}:${chapter}:${translation}`;
}

function positive(raw: string | string[] | undefined): number | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (!value || !/^\d+$/.test(value)) return null;
	const n = Number(value);
	return n >= 1 ? n : null;
}

/**
 * Connections: the fourth tab. One chapter's cross-references drawn around a
 * ring of the whole Bible, a verse list to focus any verse, its linked
 * passages tagged by section, and a short AI sheet that explains why they
 * connect. Opened from the tab bar, the reader's header and the verse sheet
 * (docs/FEATURES.md -> "Connections map").
 */
export default function ConnectionsScreen() {
	const params = useLocalSearchParams<{ book?: string; chapter?: string; verse?: string; nonce?: string }>();
	const router = useRouter();
	const getToken = useStableGetToken();
	const { colors, isDark } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const { width } = useWindowDimensions();
	const translation = useSettingsSelector((s) => s.translation);
	const scrollRef = useRef<ScrollView>(null);

	const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
	const [sectionFilter, setSectionFilter] = useState<string | null>(null);
	const [data, setData] = useState<ChapterConnections | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [overview, setOverview] = useState<ConnectionsOverview | null>(null);
	const [verseTexts, setVerseTexts] = useState<{ key: string; texts: string[] }>({ key: "", texts: [] });
	const [reloadKey, setReloadKey] = useState(0);
	const [quotes, setQuotes] = useState<Map<string, string>>(new Map());
	const [query, setQuery] = useState("");
	const [queryError, setQueryError] = useState(false);
	const [explainOpen, setExplainOpen] = useState(false);
	const explain = useConnectionsExplain(getToken);

	// Arriving from the reader or the verse sheet: jump to that place. The
	// nonce makes a second tap on the same verse still land.
	const paramBook = positive(params.book);
	const paramChapter = positive(params.chapter);
	const paramVerse = positive(params.verse);
	useEffect(() => {
		if (paramBook === null || paramChapter === null) return;
		setPlace({ order: paramBook, chapter: paramChapter, verse: paramVerse });
		setSectionFilter(null);
		scrollRef.current?.scrollTo({ y: 0, animated: false });
	}, [paramBook, paramChapter, paramVerse, params.nonce]);

	useEffect(() => {
		let live = true;
		loadConnectionsOverview()
			.then((value) => live && setOverview(value))
			.catch(() => {
				// The weave is decoration; the chapter's own links still draw.
			});
		return () => {
			live = false;
		};
	}, []);

	useEffect(() => {
		let live = true;
		const key = textsKey(place.order, place.chapter, translation);
		setLoadError(false);
		setData((current) =>
			current && current.order === place.order && current.chapter === place.chapter ? current : null
		);
		loadChapterConnections(place.order, place.chapter)
			.then((value) => live && setData(value))
			.catch(() => live && setLoadError(true));
		getChapter(translation, place.order, place.chapter)
			.then((texts) => live && setVerseTexts({ key, texts: texts.map(bibleVersePlainText) }))
			.catch(() => live && setVerseTexts({ key, texts: [] }));
		return () => {
			live = false;
		};
	}, [place.order, place.chapter, translation, reloadKey]);
	const retryChapter = useCallback(() => setReloadKey((n) => n + 1), []);

	const book = bookByOrder(place.order);
	const bookName = book?.name ?? "";
	// Texts from the previous chapter never show under this one's label.
	const chapterTexts =
		verseTexts.key === textsKey(place.order, place.chapter, translation) ? verseTexts.texts : NO_TEXTS;
	const focusRef = place.verse !== null ? `${bookName} ${place.chapter}:${place.verse}` : null;

	useEffect(() => {
		if (!focusRef) return;
		let live = true;
		setQuotes(new Map());
		loadLinkedQuotes(focusRef, translation)
			.then((value) => live && setQuotes(value))
			.catch(() => {
				// References still show and open without their text.
			});
		return () => {
			live = false;
		};
	}, [focusRef, translation]);

	const placeData = data && data.order === place.order && data.chapter === place.chapter ? data : null;
	const links = placeData?.links ?? NO_LINKS;
	const countsByVerse = useMemo(() => {
		const counts = new Map<number, number>();
		for (const link of links) counts.set(link[0], (counts.get(link[0]) ?? 0) + 1);
		return counts;
	}, [links]);
	const focusLinks = useMemo(
		() => (place.verse === null ? [] : links.filter((link) => link[0] === place.verse)),
		[links, place.verse]
	);
	const scopeLinks = place.verse === null ? links : focusLinks;
	const counts = useMemo(() => sectionCounts(scopeLinks.map((link) => link[1])), [scopeLinks]);
	const shownLinks = useMemo(
		() =>
			sectionFilter ? focusLinks.filter((link) => connectionSectionOf(link[1]).id === sectionFilter) : focusLinks,
		[focusLinks, sectionFilter]
	);
	const filteredTotal = sectionFilter ? (counts.get(sectionFilter) ?? 0) : scopeLinks.length;

	// Nearly full width: the section labels live inside the SVG, outside the ring.
	const ringSize = Math.min(width - spacing.sm * 2, 480);
	const ringTitle = place.verse !== null ? `${bookName} ${place.chapter}:${place.verse}` : `${bookName} ${place.chapter}`;
	const ringSubtitle = data
		? `${filteredTotal} ${filteredTotal === 1 ? "connection" : "connections"}`
		: loadError
			? "Could not load"
			: "Loading…";

	const focusVerse = useCallback((verse: number | null) => {
		setPlace((current) => ({ ...current, verse }));
		scrollRef.current?.scrollTo({ y: 0, animated: true });
	}, []);

	const showWholeChapter = useCallback(() => focusVerse(null), [focusVerse]);

	const goChapter = useCallback(
		(delta: number) => {
			if (!book) return;
			let order = place.order;
			let chapter = place.chapter + delta;
			if (chapter < 1) {
				order -= 1;
				chapter = bookByOrder(order)?.chapters ?? 1;
			} else if (chapter > book.chapters) {
				order += 1;
				chapter = 1;
			}
			if (!bookByOrder(order)) return;
			setSectionFilter(null);
			setPlace({ order, chapter, verse: null });
		},
		[book, place.order, place.chapter]
	);

	const submitQuery = useCallback(() => {
		const target = resolveReference(query.trim());
		if (!target) {
			setQueryError(true);
			return;
		}
		setQueryError(false);
		setQuery("");
		setSectionFilter(null);
		setPlace({ order: target.order, chapter: target.chapter, verse: target.verse ?? null });
	}, [query]);

	const openReader = useCallback(
		(order: number, chapter: number, verse?: number) => {
			router.push({
				pathname: "/bible/chapter",
				params: {
					book: String(order),
					chapter: String(chapter),
					...(verse !== undefined ? { verse: String(verse) } : {}),
					translation,
				},
			});
		},
		[router, translation]
	);

	const sectionLabel = sectionFilter ? (CONNECTION_SECTIONS.find((s) => s.id === sectionFilter)?.label ?? null) : null;
	const startExplain = useCallback(() => {
		if (!focusRef) return;
		explain.start({ reference: focusRef, translation, section: sectionFilter });
	}, [explain, focusRef, translation, sectionFilter]);

	const openExplain = useCallback(() => {
		setExplainOpen(true);
		startExplain();
	}, [startExplain]);

	const closeExplain = useCallback(() => {
		setExplainOpen(false);
		explain.reset();
	}, [explain]);

	const linkedReferences = useMemo(
		() => shownLinks.map(([, order, chapter, verse]) => `${bookByOrder(order)?.name ?? ""} ${chapter}:${verse}`),
		[shownLinks]
	);

	const continueInChat = useCallback(() => {
		if (!focusRef || place.verse === null) return;
		setExplainOpen(false);
		explain.reset();
		router.push({
			pathname: "/",
			params: {
				prompt: connectionsAskPrompt(focusRef, linkedReferences),
				attachRef: focusRef,
				attachText: chapterTexts[place.verse - 1] ?? "",
				attachTranslation: translation,
			},
		});
	}, [explain, focusRef, linkedReferences, place.verse, router, translation, chapterTexts]);

	const openExplainedReference = useCallback(
		(reference: string) => {
			const target = resolveReference(reference.split(/[--]/, 1)[0]);
			if (!target) return;
			setExplainOpen(false);
			explain.reset();
			openReader(target.order, target.chapter, target.verse);
		},
		[explain, openReader]
	);

	const onBookPress = useCallback((order: number) => {
		const id = connectionSectionOf(order).id;
		setSectionFilter((current) => (current === id ? null : id));
	}, []);

	return (
		<Screen>
			<View style={styles.header}>
				<View style={styles.headerText}>
					<Text style={styles.eyebrow}>CONNECTIONS</Text>
					<Text style={styles.headerTitle}>Scripture interprets Scripture</Text>
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`Read ${bookName} ${place.chapter}`}
					onPress={() => openReader(place.order, place.chapter, place.verse ?? undefined)}
					style={styles.iconButton}
				>
					<Ionicons name="book-outline" size={21} color={colors.text} />
				</Pressable>
				<HelpButton screen="connections" />
				<SettingsButton />
			</View>
			<ScrollView
				ref={scrollRef}
				contentContainerStyle={{ paddingBottom: tabBarSpace + spacing.xl }}
				keyboardShouldPersistTaps="handled"
			>
				<View style={styles.searchRow}>
					<Ionicons name="search" size={18} color={colors.textMuted} />
					<TextInput
						value={query}
						onChangeText={(value) => {
							setQuery(value);
							setQueryError(false);
						}}
						onSubmitEditing={submitQuery}
						placeholder="Go to… John 3:16, Psalm 22"
						placeholderTextColor={colors.textFaint}
						returnKeyType="go"
						autoCorrect={false}
						accessibilityLabel="Go to a verse or chapter"
						style={styles.searchInput}
					/>
				</View>
				{queryError ? <Text style={styles.queryError}>Try a reference like Romans 8 or John 3:16.</Text> : null}

				<View style={styles.chapterRow}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Previous chapter"
						onPress={() => goChapter(-1)}
						style={styles.iconButton}
					>
						<Ionicons name="chevron-back" size={22} color={colors.text} />
					</Pressable>
					<Text style={styles.chapterLabel}>{`${bookName} ${place.chapter}`}</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Next chapter"
						onPress={() => goChapter(1)}
						style={styles.iconButton}
					>
						<Ionicons name="chevron-forward" size={22} color={colors.text} />
					</Pressable>
				</View>

				<View style={styles.ringWrap}>
					<ConnectionsRing
						size={ringSize}
						total={data?.total ?? overview?.total ?? 31102}
						books={data?.books ?? overview?.books ?? []}
						overview={overview}
						links={links}
						chapterStart={placeData?.chapterStart ?? null}
						order={place.order}
						focusVerse={place.verse}
						sectionFilter={sectionFilter}
						title={ringTitle}
						subtitle={ringSubtitle}
						onBookPress={onBookPress}
						onCenterPress={showWholeChapter}
					/>
					{!data && !loadError ? <ActivityIndicator color={colors.accent} style={styles.ringSpinner} /> : null}
				</View>
				{loadError ? (
					<Pressable accessibilityRole="button" onPress={retryChapter} style={styles.retryRow}>
						<Text style={styles.retry}>Connections could not load. Tap to try again.</Text>
					</Pressable>
				) : null}

				<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ selected: sectionFilter === null }}
						onPress={() => setSectionFilter(null)}
						style={[styles.chip, sectionFilter === null && styles.chipActive]}
					>
						<Text style={[styles.chipText, sectionFilter === null && { color: colors.accent }]}>
							{`All ${scopeLinks.length}`}
						</Text>
					</Pressable>
					{CONNECTION_SECTIONS.map((section) => {
						const count = counts.get(section.id) ?? 0;
						const active = sectionFilter === section.id;
						// The active chip stays so the reader can always see and clear the filter.
						if (count === 0 && !active) return null;
						return (
							<Pressable
								key={section.id}
								accessibilityRole="button"
								accessibilityState={{ selected: active }}
								accessibilityLabel={`${section.label}, ${count}`}
								onPress={() => setSectionFilter(active ? null : section.id)}
								style={[styles.chip, active && { borderColor: section.color, backgroundColor: `${section.color}22` }]}
							>
								<View style={[styles.chipDot, { backgroundColor: section.color }]} />
								<Text style={[styles.chipText, active && { color: sectionInk(section.color, isDark) }]}>{`${section.label} ${count}`}</Text>
							</Pressable>
						);
					})}
				</ScrollView>

				{place.verse !== null ? (
					<View style={styles.panel}>
						<View style={styles.verseHead}>
							<Text style={styles.verseRef}>{`${bookName.toUpperCase()} ${place.chapter}:${place.verse}`}</Text>
							<Text style={styles.versionLabel}>{TRANSLATIONS[translation].label}</Text>
						</View>
						<Text style={styles.verseText}>{chapterTexts[place.verse - 1] ?? ""}</Text>
						<View style={styles.rule} />
						<View style={styles.listHead}>
							<Text style={styles.listTitle}>{`CONNECTED VERSES  ${shownLinks.length}`}</Text>
							<Pressable accessibilityRole="button" onPress={showWholeChapter} hitSlop={8}>
								<Text style={styles.listAction}>Whole chapter</Text>
							</Pressable>
						</View>
						{shownLinks.length === 0 ? (
							<Text style={styles.muted}>
								{!placeData
									? "Loading connected passages…"
									: sectionLabel && focusLinks.length > 0
										? `No links into ${sectionLabel} from this verse. Tap All to see the other ${focusLinks.length}.`
										: "No connected passages are listed for this verse."}
							</Text>
						) : null}
						{shownLinks.map(([, order, chapter, verse, index]) => {
							const section = connectionSectionOf(order);
							const reference = `${bookByOrder(order)?.name ?? ""} ${chapter}:${verse}`;
							const quote = quoteFor(quotes, reference);
							return (
								<Pressable
									key={`${index}`}
									accessibilityRole="button"
									accessibilityLabel={`Open ${reference}, ${section.label}`}
									onPress={() => openReader(order, chapter, verse)}
									style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
								>
									<View style={styles.linkHead}>
										<View style={[styles.chipDot, { backgroundColor: section.color }]} />
										<Text style={styles.linkRef}>{reference}</Text>
										<View style={[styles.tag, { borderColor: `${section.color}88` }]}>
											<Text style={[styles.tagText, { color: sectionInk(section.color, isDark) }]}>{section.label}</Text>
										</View>
										<Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
									</View>
									{quote ? (
										<Text style={styles.linkQuote} numberOfLines={3}>
											{`“${quote}”`}
										</Text>
									) : null}
								</Pressable>
							);
						})}
						{shownLinks.length > 0 ? (
							<Pressable
								accessibilityRole="button"
								onPress={openExplain}
								style={({ pressed }) => [styles.askButton, pressed && { opacity: 0.85 }]}
							>
								<Ionicons name="sparkles" size={18} color={colors.accent} />
								<Text style={styles.askLabel}>Ask why these connect</Text>
								<Ionicons name="chevron-forward" size={16} color={colors.accent} />
							</Pressable>
						) : null}
					</View>
				) : (
					<View style={styles.panel}>
						<View style={styles.listHead}>
							<Text style={styles.listTitle}>TAP A VERSE TO SEE ITS CONNECTIONS</Text>
						</View>
						{chapterTexts.map((text, at) => {
							const verse = at + 1;
							const count = countsByVerse.get(verse) ?? 0;
							return (
								<Pressable
									key={verse}
									accessibilityRole="button"
									accessibilityLabel={`Verse ${verse}, ${count} connections`}
									onPress={() => focusVerse(verse)}
									style={({ pressed }) => [styles.verseRow, pressed && styles.pressed]}
								>
									<Text style={styles.verseNumber}>{verse}</Text>
									<Text style={styles.verseRowText} numberOfLines={1}>
										{text}
									</Text>
									<View style={[styles.countBadge, count === 0 && { opacity: 0.4 }]}>
										<Text style={styles.countText}>{count}</Text>
									</View>
								</Pressable>
							);
						})}
					</View>
				)}
			</ScrollView>
			<ExplainSheet
				visible={explainOpen}
				reference={focusRef ?? ""}
				sectionLabel={sectionLabel}
				status={explain.status}
				text={explain.text}
				error={explain.error}
				onClose={closeExplain}
				onRetry={startExplain}
				onOpenReference={openExplainedReference}
				onContinueInChat={continueInChat}
			/>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
			paddingBottom: spacing.xs,
		},
		headerText: { flex: 1 },
		eyebrow: { color: c.accent, ...typography.micro, fontFamily: fonts.bodyBold, letterSpacing: 2 },
		headerTitle: { color: c.text, fontFamily: fonts.verse, fontSize: 24, lineHeight: 30 },
		iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
		searchRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginHorizontal: spacing.lg,
			marginTop: spacing.sm,
			paddingHorizontal: spacing.md,
			minHeight: 44,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		searchInput: { flex: 1, color: c.text, ...typography.control, fontFamily: fonts.body, paddingVertical: spacing.sm },
		queryError: { color: c.danger, ...typography.meta, marginHorizontal: spacing.lg, marginTop: spacing.xs },
		chapterRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.md,
			marginTop: spacing.sm,
		},
		chapterLabel: { color: c.textSecondary, ...typography.control, fontFamily: fonts.bodyBold, minWidth: 140, textAlign: "center" },
		ringWrap: { alignItems: "center", justifyContent: "center" },
		ringSpinner: { position: "absolute", bottom: 24 },
		retryRow: { alignItems: "center", paddingVertical: spacing.sm },
		retry: { color: c.accent, ...typography.support, fontFamily: fonts.bodyBold },
		chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
		chip: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingHorizontal: spacing.md,
			minHeight: 36,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		chipActive: { borderColor: c.accentBorder, backgroundColor: c.accentSoft },
		chipDot: { width: 8, height: 8, borderRadius: 4 },
		chipText: { color: c.textSecondary, ...typography.meta, fontFamily: fonts.bodyBold },
		panel: {
			marginHorizontal: spacing.lg,
			marginTop: spacing.sm,
			padding: spacing.lg,
			gap: spacing.md,
			borderRadius: radius.xl,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.glass,
		},
		verseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
		verseRef: { color: c.accent, ...typography.micro, fontFamily: fonts.bodyBold, letterSpacing: 2.4 },
		versionLabel: { color: c.textFaint, ...typography.micro, letterSpacing: 1 },
		verseText: { color: c.text, fontFamily: fonts.verse, fontSize: 25, lineHeight: 33 },
		rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },
		listHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
		listTitle: { color: c.textMuted, ...typography.micro, fontFamily: fonts.bodyBold, letterSpacing: 1.6 },
		listAction: { color: c.accent, ...typography.meta, fontFamily: fonts.bodyBold },
		muted: { color: c.textMuted, ...typography.support },
		linkCard: {
			gap: 6,
			padding: spacing.md,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			backgroundColor: c.surface,
		},
		pressed: { backgroundColor: c.surfacePressed },
		linkHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		linkRef: { flex: 1, color: c.text, ...typography.control, fontFamily: fonts.bodyBold },
		tag: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
		tagText: { ...typography.micro, fontFamily: fonts.bodyBold },
		linkQuote: { color: c.textSecondary, fontFamily: fonts.verseItalic, fontSize: 17, lineHeight: 23 },
		askButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			minHeight: 52,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		// The serif face measured short on Android and clipped "connect"; the UI face measures true.
		askLabel: { flexShrink: 1, color: c.accent, ...typography.control, fontFamily: fonts.bodyBold },
		verseRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			minHeight: 44,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.sm,
		},
		verseNumber: { width: 26, color: c.accentDim, ...typography.meta, fontFamily: fonts.bodyBold },
		verseRowText: { flex: 1, color: c.textSecondary, fontFamily: fonts.verse, fontSize: 18, lineHeight: 24 },
		countBadge: {
			minWidth: 34,
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.borderStrong,
			alignItems: "center",
		},
		countText: { color: c.text, ...typography.meta, fontFamily: fonts.bodyBold },
	});

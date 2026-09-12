import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { typography } from "@/theme";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder, resolveReference, type Reference } from "@/features/bible/books";
import { warmAllKjvBooks } from "@/features/bible/kjv";
import { searchBible, BIBLE_SEARCH_ERROR, type BibleSearchHit } from "@/features/bible/search";
import type { TranslationId } from "@/features/bible/translations";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useSettings, useTheme, useThemedStyles } from "@/features/settings/settingsStore";

const SEARCH_LIMIT = 100;
const DEBOUNCE_MS = 300;

/**
 * Translation-aware phrase search with offline KJV and a reference quick-jump.
 * Superseded requests are cancelled and stale results are dropped.
 */
export default function BibleSearchScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const [input, setInput] = useState("");
	const [hits, setHits] = useState<BibleSearchHit[]>([]);
	const [searched, setSearched] = useState("");
	const { translation: accountTranslation } = useSettings();
	const [selectedTranslation, setSelectedTranslation] = useState<TranslationId | null>(null);
	const translation = selectedTranslation ?? accountTranslation;
	const [resultTranslation, setResultTranslation] = useState<TranslationId>(translation);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	const trimmed = input.trim();
	const reference = useMemo<Reference | null>(
		() => (trimmed ? resolveReference(trimmed) : null),
		[trimmed]
	);

	// Parse the bundled books in the background while the first query is still
	// being typed, so the debounced search below does not stall the UI thread on
	// ~4 MB of JSON. One book per frame, and dropped if the screen closes first.
	useEffect(() => warmAllKjvBooks(), []);

	useEffect(() => {
		const controller = new AbortController();
		let active = true;
		setHits([]);
		setSearched("");
		setError(null);
		setLoading(trimmed.length >= 2 && !reference);
		const timer = setTimeout(() => {
			if (trimmed.length < 2 || reference) return;
			void searchBible(trimmed, translation, SEARCH_LIMIT, controller.signal).then((result) => {
				if (!active) return;
				setHits(result.hits);
				setResultTranslation(result.translation);
				setSearched(trimmed);
			}).catch(() => {
				if (active) setError(BIBLE_SEARCH_ERROR);
			}).finally(() => {
				if (active) setLoading(false);
			});
		}, DEBOUNCE_MS);
		return () => { active = false; clearTimeout(timer); controller.abort(); };
	}, [trimmed, reference, translation, attempt]);

	const openHit = (hit: { order: number; chapter: number; verse?: number; translation?: TranslationId }) => {
		router.push({
			pathname: "/bible/chapter",
			params: {
				book: String(hit.order),
				chapter: String(hit.chapter),
				translation: hit.translation ?? translation,
				...(hit.verse ? { verse: String(hit.verse) } : {}),
			},
		});
	};

	const referenceLabel = reference
		? `${bookByOrder(reference.order)?.name ?? ""} ${reference.chapter}${
				reference.verse ? `:${reference.verse}` : ""
			}`
		: "";

	const listHeader = (
		<View>
			{reference ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => openHit(reference)}
					style={({ pressed }) => [styles.jumpRow, pressed && styles.rowPressed]}
				>
					<Text style={styles.jumpLabel}>Go to {referenceLabel} →</Text>
				</Pressable>
			) : null}
			{error ? (
				<View accessibilityLiveRegion="polite">
					<Text style={styles.count}>{error}</Text>
					<Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.jumpRow}><Text style={styles.jumpLabel}>Retry search</Text></Pressable>
				</View>
			) : loading ? (
				<Text accessibilityLiveRegion="polite" style={styles.count}>Searching {translation} and checking other wording…</Text>
			) : searched ? (
				<Text style={styles.count}>
					{hits.length === 0
						? reference
							? ""
							: "No phrase matches in KJV or NKJV. Try fewer words or a reference like Job 1:8."
						: hits.length >= SEARCH_LIMIT
							? `First ${SEARCH_LIMIT} results. Refine your search.`
							: `${hits.length} result${hits.length === 1 ? "" : "s"}`}
					{hits.length > 0 && resultTranslation !== translation && ` in ${resultTranslation}. No phrase matches in ${translation}.`}
				</Text>
			) : (
				<Text style={styles.hint}>Search {translation} by word or phrase. If there are no matches, we check {translation === "KJV" ? "NKJV" : "KJV"} too. NKJV requires a connection.</Text>
			)}
		</View>
	);

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					Search
				</Text>
				<View style={styles.headerSpacer} />
			</View>

			<View style={styles.inputCard}>
					<TextInput
						autoFocus
						accessibilityLabel="Search Bible verses"
					value={input}
					onChangeText={setInput}
					placeholder='Search verses or try "John 3:16"'
					placeholderTextColor={colors.textGhost}
					returnKeyType="search"
					autoCapitalize="none"
					autoCorrect={false}
					style={styles.input}
				/>
				{input.length > 0 ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Clear search"
						onPress={() => setInput("")}
						hitSlop={8}
						style={styles.clearButton}
					>
						<Text style={styles.clearLabel}>×</Text>
					</Pressable>
				) : null}
			</View>

			<View style={{ flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg }}>
				{(["KJV", "NKJV"] as const).map((id) => (
					<Pressable key={id} accessibilityRole="button" accessibilityLabel={`Search ${id}`} accessibilityState={{ selected: translation === id }} onPress={() => setSelectedTranslation(id)} style={[styles.jumpRow, { opacity: translation === id ? 1 : 0.6 }]}>
						<Text style={styles.jumpLabel}>{id}</Text>
					</Pressable>
				))}
			</View>

			<FlatList
				data={searched ? hits : []}
				keyExtractor={(hit) => `${hit.order}:${hit.chapter}:${hit.verse}`}
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + spacing.lg }]}
				ListHeaderComponent={listHeader}
				renderItem={({ item: hit }) => (
					<Pressable
						accessibilityRole="button"
						onPress={() => openHit(hit)}
						style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
					>
						<Text style={styles.resultRef}>
							{bookByOrder(hit.order)?.name ?? `Book ${hit.order}`} {hit.chapter}:{hit.verse} {hit.translation}
						</Text>
						<Text numberOfLines={2} style={styles.resultText}>
							{hit.text}
						</Text>
					</Pressable>
				)}
			/>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		back: { color: c.accent, ...typography.control, fontWeight: "600" },
		title: {
			flex: 1,
			color: c.text,
			...typography.screenTitle,
			fontWeight: "600",
			textAlign: "center",
		},
		headerSpacer: { width: 44 },
		inputCard: {
			flexDirection: "row",
			alignItems: "center",
			marginHorizontal: spacing.lg,
			marginBottom: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
		},
		input: {
			flex: 1,
			minHeight: 44,
			color: c.text,
			fontFamily: fonts.sans,
			...typography.control,
		},
		clearButton: { padding: spacing.xs },
		clearLabel: { color: c.textMuted, ...typography.control, fontWeight: "600" },
		content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
		hint: {
			color: c.textFaint,
			...typography.support,
			textAlign: "center",
			paddingVertical: spacing.lg,
		},
		count: {
			color: c.textFaint,
			...typography.meta,
			paddingVertical: spacing.sm,
		},
		jumpRow: {
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
			marginBottom: spacing.sm,
		},
		jumpLabel: { color: c.accent, ...typography.control, fontWeight: "600" },
		resultRow: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
			marginBottom: spacing.sm,
		},
		rowPressed: { backgroundColor: c.surfacePressed },
		resultRef: { color: c.accent, ...typography.meta, fontWeight: "700", marginBottom: spacing.xs },
		resultText: { color: c.textSecondary, fontFamily: fonts.verse, ...typography.chat },
	});

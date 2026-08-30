import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { typography } from "@/theme";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder, resolveReference, type Reference } from "@/features/bible/books";
import { searchKjv, type KjvSearchHit } from "@/features/bible/kjv";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

const SEARCH_LIMIT = 100;
const DEBOUNCE_MS = 300;

/**
 * Offline verse search over the bundled KJV plus a "John 3:16"-style reference
 * quick-jump. Search runs in a debounced effect (the first call parses every
 * book JSON synchronously) and stale results are dropped when the input has
 * moved on.
 */
export default function BibleSearchScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const [input, setInput] = useState("");
	const [hits, setHits] = useState<KjvSearchHit[]>([]);
	const [searched, setSearched] = useState("");

	const trimmed = input.trim();
	const reference = useMemo<Reference | null>(
		() => (trimmed ? resolveReference(trimmed) : null),
		[trimmed]
	);

	useEffect(() => {
		const timer = setTimeout(() => {
			const query = input.trim();
			const snapshot = input;
			if (query.length < 2) {
				setHits([]);
				setSearched("");
				return;
			}
			const results = searchKjv(query, SEARCH_LIMIT);
			// Ignore the run if the input changed while the books were loading.
			setInput((current) => {
				if (current === snapshot) {
					setHits(results);
					setSearched(query);
				}
				return current;
			});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [input]);

	const openHit = (hit: { order: number; chapter: number; verse?: number }) => {
		router.push({
			pathname: "/bible/chapter",
			params: {
				book: String(hit.order),
				chapter: String(hit.chapter),
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
			{searched ? (
				<Text style={styles.count}>
					{hits.length === 0
						? reference
							? ""
							: "No verses found."
						: hits.length >= SEARCH_LIMIT
							? `First ${SEARCH_LIMIT} of many — refine your search`
							: `${hits.length} result${hits.length === 1 ? "" : "s"}`}
				</Text>
			) : (
				<Text style={styles.hint}>Search the King James text by word or phrase.</Text>
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
							{bookByOrder(hit.order)?.name ?? `Book ${hit.order}`} {hit.chapter}:{hit.verse}
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

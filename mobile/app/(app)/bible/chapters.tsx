import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { bookByOrder } from "@/features/bible/books";
import { radius, spacing, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";

const GRID_COLUMNS = 5;

/**
 * Chapter-number grid for one book. Tapping a number pushes the reading
 * screen for that chapter.
 */
export default function BibleChaptersScreen() {
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const params = useLocalSearchParams<{ book?: string }>();
	const order = Number.parseInt(typeof params.book === "string" ? params.book : "", 10);
	const book = bookByOrder(order);

	if (!book) {
		return (
			<Screen>
				<View style={styles.header}>
					<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
						<Text style={styles.back}>‹ Back</Text>
					</Pressable>
				</View>
				<View style={styles.center}>
					<Text style={styles.missing}>That book could not be found.</Text>
				</View>
			</Screen>
		);
	}

	const chapters = Array.from({ length: book.chapters }, (_, index) => index + 1);

	const openChapter = (chapter: number) => {
		router.push({
			pathname: "/bible/chapter",
			params: { book: String(book.order), chapter: String(chapter) },
		});
	};

	return (
		<Screen>
			<View style={styles.header}>
				<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
					<Text style={styles.back}>‹ Back</Text>
				</Pressable>
				<Text numberOfLines={1} style={styles.title}>
					{book.name}
				</Text>
				<View style={styles.headerSpacer} />
			</View>
			<FlatList
				data={chapters}
				keyExtractor={(chapter) => String(chapter)}
				numColumns={GRID_COLUMNS}
				contentContainerStyle={[styles.grid, { paddingBottom: tabBarSpace + spacing.lg }]}
				columnWrapperStyle={styles.gridRow}
				renderItem={({ item: chapter }) => (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`${book.name} chapter ${chapter}`}
						onPress={() => openChapter(chapter)}
						style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
					>
						<Text style={styles.cellLabel}>{chapter}</Text>
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
		back: { color: c.accent, fontSize: 15, fontWeight: "600" },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			textAlign: "center",
		},
		headerSpacer: { width: 44 },
		center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
		missing: { color: c.textMuted, fontSize: 14 },
		grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
		gridRow: { gap: spacing.sm, marginBottom: spacing.sm },
		cell: {
			flex: 1,
			aspectRatio: 1,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
		},
		cellPressed: { backgroundColor: c.surfacePressed },
		cellLabel: { color: c.textSecondary, fontSize: 15, fontWeight: "600" },
	});

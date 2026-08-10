import React, { useMemo } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { BOOKS, type Book } from "@/features/bible/books";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Bible book picker: all 66 books grouped by testament. Tapping a book pushes
 * the chapter-number grid for it.
 */
export default function BibleBooksScreen() {
	const router = useRouter();
	const tabBarSpace = useTabBarSpace();

	const sections = useMemo(
		() => [
			{ title: "Old Testament", data: BOOKS.filter((book) => book.testament === "OT") },
			{ title: "New Testament", data: BOOKS.filter((book) => book.testament === "NT") },
		],
		[]
	);

	const openBook = (book: Book) => {
		router.push({ pathname: "/bible/chapters", params: { book: String(book.order) } });
	};

	return (
		<Screen>
			<View style={styles.header}>
				<Text style={styles.heading}>Bible</Text>
			</View>
			<SectionList
				sections={sections}
				keyExtractor={(book) => String(book.order)}
				stickySectionHeadersEnabled={false}
				contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace + spacing.lg }]}
				renderSectionHeader={({ section }) => (
					<Text style={styles.sectionHeader}>{section.title}</Text>
				)}
				renderItem={({ item: book }) => (
					<Pressable
						accessibilityRole="button"
						onPress={() => openBook(book)}
						style={({ pressed }) => [styles.bookRow, pressed && styles.bookRowPressed]}
					>
						<Text style={styles.bookName}>{book.name}</Text>
						<Text style={styles.bookMeta}>
							{book.chapters} {book.chapters === 1 ? "chapter" : "chapters"}
						</Text>
					</Pressable>
				)}
			/>
		</Screen>
	);
}

const styles = StyleSheet.create({
	header: {
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
	},
	heading: { fontFamily: fonts.brand, fontSize: 34, color: colors.text },
	listContent: { paddingHorizontal: spacing.lg },
	sectionHeader: {
		color: colors.textFaint,
		fontSize: 12,
		fontWeight: "700",
		textTransform: "uppercase",
		letterSpacing: 1.2,
		paddingTop: spacing.lg,
		paddingBottom: spacing.sm,
	},
	bookRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: spacing.md,
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.lg,
		paddingVertical: 14,
		marginBottom: spacing.sm,
	},
	bookRowPressed: { backgroundColor: colors.surfacePressed },
	bookName: { color: colors.textSecondary, fontSize: 15, fontWeight: "600" },
	bookMeta: { color: colors.textGhost, fontSize: 12, fontVariant: ["tabular-nums"] },
});

import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/ui";
import { useTabBarSpace } from "@/features/chat/layout";
import { BOOKS, bookGroup, type Book, type BookGroup } from "@/features/bible/books";
import { planCardSubtitle } from "@/features/plan/planView";
import { useReadingPlan } from "@/features/plan/useReadingPlan";
import { fonts, radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

/** Collapse state remembered for the app session, like the reader's font step. */
let sessionCollapsed = { OT: false, NT: false };

type Testament = "OT" | "NT";

type ListRow =
	| { key: string; type: "testament"; testament: Testament; title: string; count: number; expanded: boolean }
	| { key: string; type: "group"; group: BookGroup }
	| { key: string; type: "book"; book: Book };

const TESTAMENTS: { testament: Testament; title: string }[] = [
	{ testament: "OT", title: "Old Testament" },
	{ testament: "NT", title: "New Testament" },
];

/** Flatten BOOKS into testament headers, genre subheaders, and book rows. */
function buildRows(collapsed: Record<Testament, boolean>): ListRow[] {
	const rows: ListRow[] = [];
	for (const { testament, title } of TESTAMENTS) {
		const books = BOOKS.filter((book) => book.testament === testament);
		const expanded = !collapsed[testament];
		rows.push({
			key: `testament-${testament}`,
			type: "testament",
			testament,
			title,
			count: books.length,
			expanded,
		});
		if (!expanded) continue;

		let currentGroup: BookGroup | null = null;
		for (const book of books) {
			const group = bookGroup(book.order);
			if (group && group !== currentGroup) {
				currentGroup = group;
				rows.push({ key: `group-${testament}-${group}`, type: "group", group });
			}
			rows.push({ key: `book-${book.order}`, type: "book", book });
		}
	}
	return rows;
}

/**
 * Bible book picker: all 66 books grouped by testament and genre, with
 * collapsible testament sections. Tapping a book pushes the chapter-number
 * grid for it.
 */
export default function BibleBooksScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const tabBarSpace = useTabBarSpace();
	const [collapsed, setCollapsed] = useState(sessionCollapsed);
	// Read-only here: the card shows where the plan stands and hands the user
	// on to the plan screen, which owns every action.
	const { plan } = useReadingPlan();

	const toggleTestament = (testament: Testament) => {
		setCollapsed((prev) => {
			const next = { ...prev, [testament]: !prev[testament] };
			sessionCollapsed = next;
			return next;
		});
	};

	const rows = useMemo(() => buildRows(collapsed), [collapsed]);

	const openBook = (book: Book) => {
		router.push({ pathname: "/bible/chapters", params: { book: String(book.order) } });
	};

	const openSearch = () => {
		router.push("/bible/search");
	};

	const openDailyCross = () => {
		router.push("/cross");
	};

	const openReadingPlan = () => {
		router.push("/bible/plan");
	};

	const openTimeline = () => {
		router.push("/bible/timeline");
	};

	return (
		<Screen>
			<View style={styles.header}>
				<Text style={styles.heading}>Bible</Text>
				<Pressable
					accessibilityRole="button"
					onPress={openSearch}
					style={({ pressed }) => [styles.searchPill, pressed && styles.bookRowPressed]}
				>
					<Ionicons name="search" size={15} color={colors.textFaint} />
					<Text style={styles.searchText}>Search the Bible</Text>
				</Pressable>
			</View>
			<FlatList
				data={rows}
				keyExtractor={(row) => row.key}
				contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace + spacing.lg }]}
				ListHeaderComponent={
					<>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={plan ? "Reading plan - today's reading" : "Start a reading plan"}
							onPress={openReadingPlan}
							style={({ pressed }) => [styles.planCard, pressed && styles.bookRowPressed]}
						>
							<Text style={styles.planGlyph}>◷</Text>
							<View style={styles.crossCopy}>
								<Text style={styles.planTitle}>
									{plan ? plan.title : "Reading plan"}
								</Text>
								<Text style={styles.crossSubtitle}>{planCardSubtitle(plan)}</Text>
							</View>
							<Text style={styles.planChevron}>›</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Timeline, people and places of the Bible"
							onPress={openTimeline}
							style={({ pressed }) => [styles.planCard, pressed && styles.bookRowPressed]}
						>
							<Text style={styles.planGlyph}>◈</Text>
							<View style={styles.crossCopy}>
								<Text style={styles.planTitle}>Timeline &amp; People</Text>
								<Text style={styles.crossSubtitle}>
									When it happened, and who was there
								</Text>
							</View>
							<Text style={styles.planChevron}>›</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Pick Up Your Cross - today's word"
							onPress={openDailyCross}
							style={({ pressed }) => [styles.crossCard, pressed && styles.bookRowPressed]}
						>
							<Text style={styles.crossGlyph}>✝</Text>
							<View style={styles.crossCopy}>
								<Text style={styles.crossTitle}>Pick Up Your Cross</Text>
								<Text style={styles.crossSubtitle}>Today&apos;s word, chosen for your walk</Text>
							</View>
							<Text style={styles.crossChevron}>›</Text>
						</Pressable>
					</>
				}
				renderItem={({ item: row }) => {
					if (row.type === "testament") {
						return (
							<Pressable
								accessibilityRole="button"
								onPress={() => toggleTestament(row.testament)}
								style={({ pressed }) => [
									styles.testamentHeader,
									pressed && styles.testamentHeaderPressed,
								]}
							>
								<Text style={styles.chevron}>{row.expanded ? "▾" : "▸"}</Text>
								<Text style={styles.testamentTitle}>{row.title}</Text>
								<Text style={styles.testamentCount}>
									{row.count} {row.count === 1 ? "book" : "books"}
								</Text>
							</Pressable>
						);
					}
					if (row.type === "group") {
						return <Text style={styles.groupHeader}>{row.group}</Text>;
					}
					return (
						<Pressable
							accessibilityRole="button"
							onPress={() => openBook(row.book)}
							style={({ pressed }) => [styles.bookRow, pressed && styles.bookRowPressed]}
						>
							<Text style={styles.bookName}>{row.book.name}</Text>
							<Text style={styles.bookMeta}>
								{row.book.chapters} {row.book.chapters === 1 ? "chapter" : "chapters"}
							</Text>
						</Pressable>
					);
				}}
			/>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		header: {
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
			paddingBottom: spacing.md,
		},
		heading: { fontFamily: fonts.brand, fontSize: 34, color: c.text },
		searchPill: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.full,
			paddingHorizontal: spacing.lg,
			paddingVertical: 10,
		},
		searchText: { color: c.textMuted, fontSize: 14 },
		listContent: { paddingHorizontal: spacing.lg },
		crossCard: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginTop: spacing.xs,
			marginBottom: spacing.sm,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		planCard: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginTop: spacing.xs,
			marginBottom: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
		},
		planGlyph: { color: c.textMuted, fontSize: 18 },
		planTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
		planChevron: { color: c.textFaint, fontSize: 18, fontWeight: "600" },
		crossGlyph: { color: c.accent, fontSize: 20 },
		crossCopy: { flex: 1, gap: 2 },
		crossTitle: { color: c.accent, fontSize: 15, fontWeight: "700" },
		crossSubtitle: { color: c.textMuted, fontSize: 12.5 },
		crossChevron: { color: c.accent, fontSize: 18, fontWeight: "600" },
		testamentHeader: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingTop: spacing.lg,
			paddingBottom: spacing.sm,
		},
		testamentHeaderPressed: { opacity: 0.7 },
		chevron: { color: c.textFaint, fontSize: 12, width: 12 },
		testamentTitle: {
			flex: 1,
			color: c.textFaint,
			fontSize: 12,
			fontWeight: "700",
			textTransform: "uppercase",
			letterSpacing: 1.2,
		},
		testamentCount: { color: c.textGhost, fontSize: 12, fontVariant: ["tabular-nums"] },
		groupHeader: {
			fontFamily: fonts.sans,
			color: c.textMuted,
			fontSize: 11,
			fontWeight: "600",
			textTransform: "uppercase",
			letterSpacing: 1,
			paddingTop: spacing.sm,
			paddingBottom: spacing.xs,
		},
		bookRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.lg,
			paddingVertical: 14,
			marginBottom: spacing.sm,
		},
		bookRowPressed: { backgroundColor: c.surfacePressed },
		bookName: { color: c.textSecondary, fontSize: 15, fontWeight: "600" },
		bookMeta: { color: c.textGhost, fontSize: 12, fontVariant: ["tabular-nums"] },
	});

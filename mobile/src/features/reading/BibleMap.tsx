import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { BOOKS } from "@/features/bible/books";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";
import {
	defaultTestament,
	testamentProgress,
	type BookCoverage,
	type BookProgress,
} from "./readingOverview";

const COLUMNS = 3;

/**
 * The whole Bible at a glance: every book of a testament with how many of its
 * chapters have been read whole, and a chapter grid for the selected book.
 * Gold squares are chapters read in one sitting; outlined ones were started.
 */
export function BibleMap({ coverage }: { coverage: BookCoverage[] }) {
	const router = useRouter();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const preferred = useMemo(() => defaultTestament(BOOKS, coverage), [coverage]);
	const [testament, setTestament] = useState<"OT" | "NT" | null>(null);
	const shown = testament ?? preferred;
	const books = useMemo(() => testamentProgress(BOOKS, coverage, shown), [coverage, shown]);
	const [selected, setSelected] = useState<number | null>(null);
	const open = books.find((book) => book.order === selected) ?? null;
	// The chapter grid opens under the selected book's row, so it is on screen
	// right where the tap happened rather than below all 39 Old Testament books.
	const rows = useMemo(() => {
		const chunks: BookProgress[][] = [];
		for (let i = 0; i < books.length; i += COLUMNS) chunks.push(books.slice(i, i + COLUMNS));
		return chunks;
	}, [books]);

	return (
		<View style={styles.section}>
			<View style={styles.header}>
				<Text accessibilityRole="header" style={styles.heading}>
					Your Bible
				</Text>
				<View style={styles.segment} accessibilityRole="tablist">
					{(["OT", "NT"] as const).map((key) => (
						<Pressable
							key={key}
							accessibilityRole="tab"
							accessibilityState={{ selected: shown === key }}
							onPress={() => {
								setTestament(key);
								setSelected(null);
							}}
							style={[styles.segmentItem, shown === key && styles.segmentActive]}
						>
							<Text style={[styles.segmentLabel, shown === key && styles.segmentLabelActive]}>
								{key === "OT" ? "Old Testament" : "New Testament"}
							</Text>
						</Pressable>
					))}
				</View>
			</View>
			{!open ? <Text style={styles.hint}>Tap a book to see its chapters.</Text> : null}
			{rows.map((row) => (
				<React.Fragment key={row[0].order}>
					<View style={styles.grid}>
						{row.map((book) => (
							<BookTile
								key={book.order}
								book={book}
								selected={book.order === selected}
								onPress={() => setSelected(book.order === selected ? null : book.order)}
								styles={styles}
								colors={colors}
							/>
						))}
					</View>
					{open && row.includes(open) ? (
						<View style={styles.chapters}>
							<Text style={styles.chapterTitle}>
								{open.name} · {open.complete.size} of {open.chapters}{" "}
								{open.chapters === 1 ? "chapter" : "chapters"} read
							</Text>
							<View style={styles.chapterGrid}>
								{Array.from({ length: open.chapters }, (_, i) => i + 1).map((chapter) => {
									const done = open.complete.has(chapter);
									const started = !done && open.started.has(chapter);
									return (
										<Pressable
											key={chapter}
											accessibilityRole="button"
											accessibilityLabel={`${open.name} ${chapter}, ${done ? "read" : started ? "started" : "not read yet"}`}
											onPress={() =>
												router.push({
													pathname: "/bible/chapter",
													params: { book: String(open.order), chapter: String(chapter), verse: "1" },
												})
											}
											style={[styles.square, done && styles.squareDone, started && styles.squareStarted]}
										>
											<Text style={[styles.squareLabel, done && styles.squareLabelDone]}>{chapter}</Text>
										</Pressable>
									);
								})}
							</View>
						</View>
					) : null}
				</React.Fragment>
			))}
		</View>
	);
}

function BookTile({
	book,
	selected,
	onPress,
	styles,
	colors,
}: {
	book: BookProgress;
	selected: boolean;
	onPress: () => void;
	styles: ReturnType<typeof createStyles>;
	colors: Colors;
}) {
	const touched = book.complete.size + book.started.size > 0;
	const share = book.complete.size / book.chapters;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ expanded: selected }}
			accessibilityLabel={`${book.name}, ${book.complete.size} of ${book.chapters} chapters read`}
			onPress={onPress}
			style={({ pressed }) => [
				styles.tile,
				!touched && styles.tileUntouched,
				selected && styles.tileSelected,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			<Text numberOfLines={1} style={[styles.tileName, !touched && styles.tileNameUntouched]}>
				{book.name}
			</Text>
			<Text style={styles.tileCount}>
				{book.complete.size}/{book.chapters}
			</Text>
			<View style={styles.bar}>
				<View style={[styles.barFill, { width: `${Math.round(share * 100)}%` }]} />
			</View>
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		section: { gap: spacing.sm },
		header: { gap: spacing.sm, marginBottom: spacing.xs },
		heading: { color: c.text, ...typography.sectionTitle, fontWeight: "700" },
		segment: {
			flexDirection: "row",
			backgroundColor: c.surface,
			borderRadius: radius.full,
			padding: 3,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
		},
		segmentItem: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full, alignItems: "center" },
		segmentActive: { backgroundColor: c.accentSoft },
		segmentLabel: { color: c.textMuted, ...typography.meta, fontWeight: "600" },
		segmentLabelActive: { color: c.accent },
		grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		tile: {
			width: "31.5%",
			padding: spacing.sm,
			borderRadius: radius.md,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			gap: 2,
		},
		tileUntouched: { opacity: 0.55 },
		tileSelected: { borderColor: c.accent, opacity: 1 },
		tileName: { color: c.text, ...typography.meta, fontWeight: "600" },
		tileNameUntouched: { color: c.textMuted },
		tileCount: { color: c.textFaint, ...typography.micro },
		bar: { height: 3, borderRadius: 2, backgroundColor: c.border, overflow: "hidden", marginTop: 2 },
		barFill: { height: 3, backgroundColor: c.accent },
		chapters: {
			gap: spacing.sm,
			padding: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
		},
		chapterTitle: { color: c.text, ...typography.control, fontWeight: "600" },
		chapterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
		square: {
			width: 48,
			height: 48,
			borderRadius: radius.sm,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surfaceStrong,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		squareDone: { backgroundColor: c.accent, borderColor: c.accent },
		squareStarted: { borderColor: c.accent, borderWidth: 1.5, backgroundColor: c.accentSoft },
		squareLabel: { color: c.textMuted, ...typography.micro, fontWeight: "600" },
		// Near-black on gold in both themes: light text on the light theme's
		// amber falls well under 4.5:1.
		squareLabelDone: { color: "#111111" },
		hint: { color: c.textFaint, ...typography.meta },
	});

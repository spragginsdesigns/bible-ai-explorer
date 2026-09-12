import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { apiJson, type GetToken } from "@/lib/api";
import { resolveReference } from "@/features/bible/books";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/**
 * C1 "See also": the curated cross-references for the verse in the sheet,
 * from GET /api/bible/crossrefs (the 2.9MB set is not in the bundle).
 * Collapsed to one row; expanding shows the top five with their text in the
 * reader's translation. Hides itself entirely when the verse has no edges or
 * the route is not yet deployed. Mounted in the verse sheet in
 * mobile/app/(app)/bible/chapter.tsx.
 */

interface CrossReferenceRow {
	reference: string;
	text?: string;
}

interface SeeAlsoSectionProps {
	getToken: GetToken;
	/** "Romans 8:28" — the sheet's verse. */
	reference: string | null;
	translation: string;
}

export function SeeAlsoSection({ getToken, reference, translation }: SeeAlsoSectionProps) {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [rows, setRows] = useState<CrossReferenceRow[] | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		setRows(null);
		setOpen(false);
		if (!reference) return;
		let cancelled = false;
		const params = new URLSearchParams({ reference, translation });
		apiJson<{ crossReferences?: CrossReferenceRow[] }>(
			getToken,
			`/api/bible/crossrefs?${params.toString()}`
		)
			.then((data) => {
				if (cancelled) return;
				const list = data.crossReferences ?? [];
				setRows(list.length > 0 ? list : null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [getToken, reference, translation]);

	if (!rows) return null;

	const openRef = (rowReference: string) => {
		// Ranges ("John 3:16-18") open at their start.
		const target = resolveReference(rowReference.split("-")[0]);
		if (!target) return;
		router.push({
			pathname: "/bible/chapter",
			params: { book: String(target.order), chapter: String(target.chapter), translation },
		});
	};

	return (
		<View style={styles.card}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`See also, ${rows.length} cross-references`}
				onPress={() => setOpen((prev) => !prev)}
				style={({ pressed }) => [styles.header, pressed && styles.pressed]}
			>
				<Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
				<Text style={styles.title}>See also</Text>
				<Text style={styles.count}>{rows.length}</Text>
			</Pressable>
			{open ? (
				<View style={styles.list}>
					{rows.map((row) => (
						<View key={row.reference} style={styles.row}>
							<Pressable
								accessibilityRole="link"
								accessibilityLabel={`Open ${row.reference}`}
								onPress={() => openRef(row.reference)}
								hitSlop={4}
							>
								<Text style={styles.reference}>{row.reference}</Text>
							</Pressable>
							{row.text ? <Text style={styles.text}>{row.text}</Text> : null}
						</View>
					))}
				</View>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			marginBottom: spacing.sm,
		},
		header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 34 },
		pressed: { opacity: 0.7 },
		chevron: { color: c.textFaint, ...typography.micro, width: 12 },
		title: {
			flex: 1,
			color: c.textMuted,
			...typography.meta,
			fontWeight: "700",
			textTransform: "uppercase",
			letterSpacing: 1,
		},
		count: { color: c.textGhost, ...typography.micro, fontVariant: ["tabular-nums"] },
		list: { gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
		row: { gap: 2 },
		reference: { color: c.accent, ...typography.support, fontWeight: "600" },
		text: { color: c.textSecondary, ...typography.support, lineHeight: 20 },
	});

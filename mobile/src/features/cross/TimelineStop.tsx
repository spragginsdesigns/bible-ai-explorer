import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";

/**
 * One stop on the guided timeline: an amber node on a vertical rail, with the
 * section content to its right. The rail connects the day into one walk.
 *
 * Its own module because the Listen card renders its own stop: a card that can
 * decide to show nothing at all (an unconfigured server) has to own the node
 * and label above it, or the screen would leave an empty ♪ hanging on the rail.
 *
 * Mirrors src/components/cross/TimelineStop.tsx on web.
 */
export function TimelineStop({
	glyph,
	label,
	last = false,
	children,
}: {
	glyph: string;
	label?: string;
	last?: boolean;
	children: React.ReactNode;
}) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.tlRow}>
			<View style={styles.tlRail}>
				<View style={styles.tlNode}>
					<Text style={styles.tlNodeGlyph}>{glyph}</Text>
				</View>
				{!last ? <View style={styles.tlLine} /> : null}
			</View>
			<View style={[styles.tlContent, last && { paddingBottom: 0 }]}>
				{label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
				{children}
			</View>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		tlRow: { flexDirection: "row", gap: spacing.md },
		tlRail: { width: 28, alignItems: "center" },
		tlNode: {
			width: 28,
			height: 28,
			borderRadius: 14,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
			// Subtle glow so the rail reads as lit, not drawn.
			shadowColor: c.accent,
			shadowOpacity: 0.5,
			shadowRadius: 6,
			shadowOffset: { width: 0, height: 0 },
			elevation: 2,
		},
		tlNodeGlyph: { color: c.accent, fontSize: 13, fontWeight: "700" },
		tlLine: {
			flex: 1,
			width: 2,
			marginVertical: 4,
			borderRadius: 1,
			backgroundColor: c.accentBorder,
		},
		tlContent: { flex: 1, gap: spacing.sm, paddingBottom: spacing.xl },
		sectionLabel: {
			color: c.accentDim,
			...typography.meta,
			fontWeight: "700",
			letterSpacing: 1.2,
			paddingTop: 6,
		},
	});

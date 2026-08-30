import React, { useCallback } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import type { TavilyResult } from "@/lib/chatView";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { Collapsible } from "./Collapsible";

function WebResultRow({ result }: { result: TavilyResult }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const open = useCallback(() => {
		void Linking.openURL(result.url).catch(() => {
			// A malformed or unhandled URL is not worth interrupting the chat for.
		});
	}, [result.url]);

	return (
		<Pressable
			accessibilityRole="link"
			onPress={open}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
		>
			<Text style={styles.title} numberOfLines={2}>
				{result.title}
			</Text>
			<Text style={styles.snippet} numberOfLines={2}>
				{result.content}
			</Text>
			<View style={styles.linkRow}>
				<Text style={styles.link} numberOfLines={1}>
					{result.url}
				</Text>
				<Text style={styles.linkGlyph}>↗</Text>
			</View>
		</Pressable>
	);
}

export function WebResultsCard({ results }: { results: TavilyResult[] }) {
	return (
		<Collapsible glyph="🌐" title={`Web results (${results.length})`}>
			{results.map((result, index) => (
				<WebResultRow key={`${result.url}-${index}`} result={result} />
			))}
		</Collapsible>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		row: {
			paddingVertical: spacing.md,
			paddingHorizontal: spacing.sm,
			marginHorizontal: -spacing.sm,
			borderRadius: radius.md,
		},
		title: { color: c.text, fontSize: 13, fontWeight: "600" },
		snippet: { ...typography.support, marginTop: spacing.xs, color: c.textMuted },
		linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
		link: { ...typography.micro, flexShrink: 1, color: c.textGhost },
		linkGlyph: { ...typography.micro, color: c.textGhost },
	});

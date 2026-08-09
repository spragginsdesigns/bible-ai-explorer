import React, { useCallback } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { TavilyResult } from "@/lib/chatView";
import { colors, radius, spacing } from "@/theme";
import { Collapsible } from "./Collapsible";

function WebResultRow({ result }: { result: TavilyResult }) {
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

const styles = StyleSheet.create({
	row: {
		paddingVertical: spacing.md,
		paddingHorizontal: spacing.sm,
		marginHorizontal: -spacing.sm,
		borderRadius: radius.md,
	},
	title: { color: colors.text, fontSize: 13, fontWeight: "600" },
	snippet: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
	linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
	link: { flexShrink: 1, color: colors.textGhost, fontSize: 11 },
	linkGlyph: { color: colors.textGhost, fontSize: 11 },
});

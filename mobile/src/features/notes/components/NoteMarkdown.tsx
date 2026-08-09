import React, { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Markdown, { hasParents, type RenderRules } from "react-native-markdown-display";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * Markdown for AI answers. Blockquotes are the Scripture treatment: Cormorant
 * Garamond at 18pt behind an amber rule, matching the web FormattedResponse.
 */
export function NoteMarkdown({ content }: { content: string }) {
	const rules: RenderRules = useMemo(
		() => ({
			blockquote: (node, children) => (
				<View key={node.key} style={styles.blockquote}>
					{children}
				</View>
			),
			// react-native-markdown-display has no descendant selectors, so the
			// Scripture font is applied by checking the ancestor chain here.
			textgroup: (node, children, parents) => (
				<Text
					key={node.key}
					style={hasParents(parents, "blockquote") ? styles.verse : styles.textgroup}
				>
					{children}
				</Text>
			),
		}),
		[]
	);

	return (
		<Markdown
			style={markdownStyles}
			rules={rules}
			onLinkPress={(url) => {
				void Linking.openURL(url);
				return false;
			}}
		>
			{content}
		</Markdown>
	);
}

const styles = StyleSheet.create({
	blockquote: {
		backgroundColor: colors.accentSoft,
		borderLeftWidth: 2,
		borderLeftColor: colors.accent,
		borderTopRightRadius: radius.md,
		borderBottomRightRadius: radius.md,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		marginVertical: spacing.sm,
	},
	verse: {
		fontFamily: fonts.verse,
		fontSize: 18,
		lineHeight: 26,
		color: colors.textSecondary,
	},
	textgroup: {
		fontSize: 14,
		lineHeight: 21,
		color: colors.textSecondary,
	},
});

const markdownStyles = StyleSheet.create({
	body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
	paragraph: { marginTop: 0, marginBottom: spacing.sm },
	heading1: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 6 },
	heading2: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
	heading3: { color: colors.textSecondary, fontSize: 15, fontWeight: "600", marginBottom: 4 },
	strong: { color: colors.text, fontWeight: "700" },
	em: { fontStyle: "italic" },
	link: { color: colors.accent, textDecorationLine: "underline" },
	bullet_list: { marginBottom: spacing.sm },
	ordered_list: { marginBottom: spacing.sm },
	list_item: { marginBottom: 2 },
	bullet_list_icon: { color: colors.accentDim, marginRight: 6 },
	ordered_list_icon: { color: colors.accentDim, marginRight: 6 },
	code_inline: {
		backgroundColor: colors.surfaceStrong,
		color: colors.text,
		borderRadius: radius.sm,
		paddingHorizontal: 5,
	},
	fence: {
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: colors.textSecondary,
		padding: spacing.md,
	},
	code_block: {
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: colors.textSecondary,
		padding: spacing.md,
	},
	hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
	table: { borderColor: colors.border, borderRadius: radius.sm },
	th: { color: colors.text },
	td: { color: colors.textSecondary },
});

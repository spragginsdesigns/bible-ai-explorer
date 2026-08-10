import React, { useMemo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import Markdown, { hasParents, type RenderRules } from "react-native-markdown-display";
import { fonts, radius, spacing } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/**
 * Markdown for AI answers. Blockquotes are the Scripture treatment: Cormorant
 * Garamond at 18pt behind an amber rule, matching the web FormattedResponse.
 */
export function NoteMarkdown({ content }: { content: string }) {
	const styles = useThemedStyles(createStyles);
	const markdownStyles = useThemedStyles(createMarkdownStyles);

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
		[styles]
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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		blockquote: {
			backgroundColor: c.accentSoft,
			borderLeftWidth: 2,
			borderLeftColor: c.accent,
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
			color: c.textSecondary,
		},
		textgroup: {
			fontSize: 14,
			lineHeight: 21,
			color: c.textSecondary,
		},
	});

const createMarkdownStyles = (c: Colors) =>
	StyleSheet.create({
		body: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
		paragraph: { marginTop: 0, marginBottom: spacing.sm },
		heading1: { color: c.text, fontSize: 18, fontWeight: "700", marginBottom: 6 },
		heading2: { color: c.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
		heading3: { color: c.textSecondary, fontSize: 15, fontWeight: "600", marginBottom: 4 },
		strong: { color: c.text, fontWeight: "700" },
		em: { fontStyle: "italic" },
		link: { color: c.accent, textDecorationLine: "underline" },
		bullet_list: { marginBottom: spacing.sm },
		ordered_list: { marginBottom: spacing.sm },
		list_item: { marginBottom: 2 },
		bullet_list_icon: { color: c.accentDim, marginRight: 6 },
		ordered_list_icon: { color: c.accentDim, marginRight: 6 },
		code_inline: {
			backgroundColor: c.surfaceStrong,
			color: c.text,
			borderRadius: radius.sm,
			paddingHorizontal: 5,
		},
		fence: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			color: c.textSecondary,
			padding: spacing.md,
		},
		code_block: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			color: c.textSecondary,
			padding: spacing.md,
		},
		hr: { backgroundColor: c.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
		table: { borderColor: c.border, borderRadius: radius.sm },
		th: { color: c.text },
		td: { color: c.textSecondary },
	});

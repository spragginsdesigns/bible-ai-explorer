import React from "react";
import { StyleSheet, Text } from "react-native";
import Markdown, { MarkdownIt, type MarkdownProps } from "react-native-markdown-display";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * react-native-markdown-display cascades text-only style props from a parent
 * node down to its leaf Text nodes, so `blockquote` can carry both the card
 * chrome and the Cormorant Scripture typography in one entry.
 */
const markdownStyles = {
	body: {
		color: colors.text,
		fontSize: 15,
		lineHeight: 24,
	},
	paragraph: {
		marginTop: 0,
		marginBottom: spacing.md,
	},
	heading1: {
		color: colors.text,
		fontSize: 21,
		lineHeight: 28,
		fontWeight: "700" as const,
		marginTop: spacing.md,
		marginBottom: spacing.xs,
	},
	heading2: {
		color: colors.text,
		fontSize: 18,
		lineHeight: 25,
		fontWeight: "700" as const,
		marginTop: spacing.md,
		marginBottom: spacing.xs,
	},
	heading3: {
		color: colors.textSecondary,
		fontSize: 16,
		lineHeight: 23,
		fontWeight: "700" as const,
		marginTop: spacing.sm,
		marginBottom: spacing.xs,
	},
	heading4: {
		color: colors.textSecondary,
		fontSize: 15,
		lineHeight: 22,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
		marginBottom: spacing.xs,
	},
	heading5: {
		color: colors.textMuted,
		fontSize: 14,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
	},
	heading6: {
		color: colors.textMuted,
		fontSize: 13,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
	},
	strong: {
		color: colors.text,
		fontWeight: "700" as const,
	},
	em: {
		fontStyle: "italic" as const,
	},
	// The signature look: quoted Scripture as an amber-edged glass slab.
	blockquote: {
		backgroundColor: colors.accentSoft,
		borderColor: colors.accent,
		borderLeftWidth: 3,
		borderRadius: radius.md,
		marginLeft: 0,
		marginBottom: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
		color: colors.textSecondary,
		fontFamily: fonts.verse,
		fontSize: 18,
		lineHeight: 26,
	},
	hr: {
		backgroundColor: colors.borderStrong,
		height: StyleSheet.hairlineWidth,
		marginVertical: spacing.lg,
	},
	link: {
		color: colors.accent,
		textDecorationLine: "underline" as const,
	},
	blocklink: {
		borderColor: colors.accentBorder,
	},
	bullet_list: {
		marginBottom: spacing.md,
	},
	ordered_list: {
		marginBottom: spacing.md,
	},
	list_item: {
		marginBottom: spacing.xs,
	},
	bullet_list_icon: {
		color: colors.accent,
		marginLeft: 0,
		marginRight: spacing.sm,
	},
	ordered_list_icon: {
		color: colors.accent,
		marginLeft: 0,
		marginRight: spacing.sm,
	},
	code_inline: {
		backgroundColor: colors.surfaceStrong,
		borderWidth: 0,
		borderRadius: radius.sm,
		color: colors.accent,
		fontSize: 14,
		// The library default is a 10px box, which pushes inline code off the line.
		padding: 0,
		paddingHorizontal: spacing.xs,
	},
	code_block: {
		backgroundColor: colors.bgElevated,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: colors.textSecondary,
		padding: spacing.md,
		marginBottom: spacing.md,
	},
	fence: {
		backgroundColor: colors.bgElevated,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: colors.textSecondary,
		padding: spacing.md,
		marginBottom: spacing.md,
	},
	table: {
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		marginBottom: spacing.md,
	},
	th: {
		color: colors.textMuted,
		fontWeight: "600" as const,
		padding: spacing.sm,
	},
	td: {
		color: colors.textSecondary,
		padding: spacing.sm,
	},
	tr: {
		borderColor: colors.border,
	},
};

/**
 * The shipped MarkdownProps typing omits several props the component actually
 * reads. They matter here because every one of them is a memo dependency: left
 * to their defaults they are rebuilt each render, which reparses the whole
 * document on every streamed token.
 */
type FullMarkdownProps = MarkdownProps & {
	allowedImageHandlers?: string[];
	topLevelMaxExceededItem?: React.ReactNode;
	maxTopLevelChildren?: number | null;
};

const MarkdownView = Markdown as React.ComponentType<React.PropsWithChildren<FullMarkdownProps>>;

const markdownIt = MarkdownIt({ typographer: true, linkify: true });
const imageHandlers = ["https://", "http://"];
const truncationMarker = <Text key="markdown-truncated">…</Text>;

export const MarkdownBody = React.memo(function MarkdownBody({ content }: { content: string }) {
	return (
		<MarkdownView
			style={markdownStyles}
			markdownit={markdownIt}
			allowedImageHandlers={imageHandlers}
			topLevelMaxExceededItem={truncationMarker}
		>
			{content}
		</MarkdownView>
	);
});

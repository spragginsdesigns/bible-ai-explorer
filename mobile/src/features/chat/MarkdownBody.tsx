import React, { useCallback } from "react";
import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import Markdown, { MarkdownIt, type MarkdownProps } from "react-native-markdown-display";
import { fonts, radius, spacing } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { openReferenceInReader, VERSE_REF_SCHEME, verseReferencePlugin } from "./verseLinks";

/**
 * react-native-markdown-display cascades text-only style props from a parent
 * node down to its leaf Text nodes, so `blockquote` can carry both the card
 * chrome and the Cormorant Scripture typography in one entry.
 */
const createMarkdownStyles = (c: Colors) => ({
	body: {
		color: c.text,
		fontSize: 15,
		lineHeight: 24,
	},
	paragraph: {
		marginTop: 0,
		marginBottom: spacing.md,
	},
	heading1: {
		color: c.text,
		fontSize: 21,
		lineHeight: 28,
		fontWeight: "700" as const,
		marginTop: spacing.md,
		marginBottom: spacing.xs,
	},
	heading2: {
		color: c.text,
		fontSize: 18,
		lineHeight: 25,
		fontWeight: "700" as const,
		marginTop: spacing.md,
		marginBottom: spacing.xs,
	},
	heading3: {
		color: c.textSecondary,
		fontSize: 16,
		lineHeight: 23,
		fontWeight: "700" as const,
		marginTop: spacing.sm,
		marginBottom: spacing.xs,
	},
	heading4: {
		color: c.textSecondary,
		fontSize: 15,
		lineHeight: 22,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
		marginBottom: spacing.xs,
	},
	heading5: {
		color: c.textMuted,
		fontSize: 14,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
	},
	heading6: {
		color: c.textMuted,
		fontSize: 13,
		fontWeight: "600" as const,
		marginTop: spacing.sm,
	},
	strong: {
		color: c.text,
		fontWeight: "700" as const,
	},
	em: {
		fontStyle: "italic" as const,
	},
	// The signature look: quoted Scripture as an amber-edged glass slab.
	blockquote: {
		backgroundColor: c.accentSoft,
		borderColor: c.accent,
		borderLeftWidth: 3,
		borderRadius: radius.md,
		marginLeft: 0,
		marginBottom: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
		color: c.textSecondary,
		fontFamily: fonts.verse,
		fontSize: 18,
		lineHeight: 26,
	},
	hr: {
		backgroundColor: c.borderStrong,
		height: StyleSheet.hairlineWidth,
		marginVertical: spacing.lg,
	},
	link: {
		color: c.accent,
		textDecorationLine: "underline" as const,
	},
	blocklink: {
		borderColor: c.accentBorder,
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
		color: c.accent,
		marginLeft: 0,
		marginRight: spacing.sm,
	},
	ordered_list_icon: {
		color: c.accent,
		marginLeft: 0,
		marginRight: spacing.sm,
	},
	code_inline: {
		backgroundColor: c.surfaceStrong,
		borderWidth: 0,
		borderRadius: radius.sm,
		color: c.accent,
		fontSize: 14,
		// The library default is a 10px box, which pushes inline code off the line.
		padding: 0,
		paddingHorizontal: spacing.xs,
	},
	code_block: {
		backgroundColor: c.bgElevated,
		borderColor: c.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: c.textSecondary,
		padding: spacing.md,
		marginBottom: spacing.md,
	},
	fence: {
		backgroundColor: c.bgElevated,
		borderColor: c.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		color: c.textSecondary,
		padding: spacing.md,
		marginBottom: spacing.md,
	},
	table: {
		borderColor: c.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.md,
		marginBottom: spacing.md,
	},
	th: {
		color: c.textMuted,
		fontWeight: "600" as const,
		padding: spacing.sm,
	},
	td: {
		color: c.textSecondary,
		padding: spacing.sm,
	},
	tr: {
		borderColor: c.border,
	},
});

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
// Tappable Bible references ("John 3:16") as amber links deep-linking to the reader.
markdownIt.use(verseReferencePlugin);

/**
 * The chat-configured parser, shared with the notes AI panel (NoteMarkdown) so
 * an answer renders the same in both places: linkified URLs and tappable
 * verse references included.
 */
export const sureWordMarkdownIt = markdownIt;
const imageHandlers = ["https://", "http://"];
const truncationMarker = <Text key="markdown-truncated">…</Text>;

export const MarkdownBody = React.memo(function MarkdownBody({ content }: { content: string }) {
	const markdownStyles = useThemedStyles(createMarkdownStyles);
	const router = useRouter();
	// Returning false keeps react-native-markdown-display from Linking.openURL;
	// ordinary links return true to keep the previous open-in-browser behavior.
	const onLinkPress = useCallback(
		(url: string) => {
			if (url.startsWith(VERSE_REF_SCHEME)) {
				openReferenceInReader(router, url.slice(VERSE_REF_SCHEME.length));
				return false;
			}
			return true;
		},
		[router]
	);
	return (
		<MarkdownView
			style={markdownStyles}
			markdownit={markdownIt}
			onLinkPress={onLinkPress}
			allowedImageHandlers={imageHandlers}
			topLevelMaxExceededItem={truncationMarker}
		>
			{content}
		</MarkdownView>
	);
});

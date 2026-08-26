import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import Markdown, {
	MarkdownIt,
	type MarkdownProps,
	type RenderFunction,
	type RenderRules,
} from "react-native-markdown-display";
import { fonts, radius, spacing } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { openReferenceInReader, VERSE_REF_SCHEME, verseReferencePlugin } from "./verseLinks";
import {
	ALLOWED_IMAGE_HANDLERS,
	configureLinkify,
	DEFAULT_IMAGE_HANDLER,
	isLastChildOfBlockquote,
	softbreakContent,
} from "./markdownRules";

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
	defaultImageHandler?: string | null;
	topLevelMaxExceededItem?: React.ReactNode;
	maxTopLevelChildren?: number | null;
};

/** Shared with NoteMarkdown so both panels can pass the memo-stable props above. */
export const MarkdownView = Markdown as React.ComponentType<
	React.PropsWithChildren<FullMarkdownProps>
>;

const markdownIt = MarkdownIt({ typographer: true, linkify: true });
// Sentence-openers that are also ccTLDs ("God.It") must not become links.
configureLinkify(markdownIt);
// Tappable Bible references ("John 3:16") as amber links deep-linking to the reader.
markdownIt.use(verseReferencePlugin);

/**
 * The chat-configured parser, shared with the notes AI panel (NoteMarkdown) so
 * an answer renders the same in both places: linkified URLs and tappable
 * verse references included.
 */
export const sureWordMarkdownIt = markdownIt;
const truncationMarker = <Text key="markdown-truncated">…</Text>;

/** The library types the style bag as `any`; this is the surface the rules use. */
interface MarkdownStyleBag {
	readonly [key: string]: StyleProp<ViewStyle & TextStyle>;
}

const localStyles = StyleSheet.create({
	flushBottom: { marginBottom: 0 },
});

/**
 * The library renders paragraphs, lists and headings as the same shape - a View
 * carrying the `_VIEW_SAFE_*` slice of the style bag - so one factory covers
 * every block that can end a Scripture card. A card that ends in a list or a
 * heading needs the flush margin exactly as much as one that ends in a
 * paragraph; only paragraphs used to get it.
 */
const flushableBlock =
	(styleKey: string): RenderFunction =>
	(node, children, parents, styles: MarkdownStyleBag) => (
		<View
			key={node.key}
			style={[styles[styleKey], isLastChildOfBlockquote(node, parents) && localStyles.flushBottom]}
		>
			{children}
		</View>
	);

/**
 * Module-level so the object identity is stable: the library memoizes its
 * AstRenderer on prop identity, and a fresh `rules` object on every render
 * rebuilds the renderer and reparses the document on every streamed token.
 */
export const sureWordMarkdownRules: RenderRules = {
	softbreak: (node, _children, parents, styles: MarkdownStyleBag) => (
		<Text key={node.key} style={styles.softbreak}>
			{softbreakContent(parents)}
		</Text>
	),
	paragraph: flushableBlock("_VIEW_SAFE_paragraph"),
	bullet_list: flushableBlock("_VIEW_SAFE_bullet_list"),
	ordered_list: flushableBlock("_VIEW_SAFE_ordered_list"),
	heading1: flushableBlock("_VIEW_SAFE_heading1"),
	heading2: flushableBlock("_VIEW_SAFE_heading2"),
	heading3: flushableBlock("_VIEW_SAFE_heading3"),
	heading4: flushableBlock("_VIEW_SAFE_heading4"),
	heading5: flushableBlock("_VIEW_SAFE_heading5"),
	heading6: flushableBlock("_VIEW_SAFE_heading6"),
};

/**
 * Coalesce streamed deltas to ~12 Hz. Every delta changes `content`, and the
 * library reparses the whole document and remounts every node (its keys come
 * from a module-level counter, so nothing can be reconciled), which measured
 * 671 re-parses for one 4 KB answer streamed at 6-character chunks. The first
 * value renders immediately so a settled message never waits, and the trailing
 * timer guarantees the final text always lands.
 */
const RENDER_INTERVAL_MS = 80;

function useCoalescedContent(content: string): string {
	const [displayed, setDisplayed] = useState(content);
	const lastRenderedAt = useRef(Date.now());

	useEffect(() => {
		if (content === displayed) return;

		const elapsed = Date.now() - lastRenderedAt.current;
		if (elapsed >= RENDER_INTERVAL_MS) {
			lastRenderedAt.current = Date.now();
			setDisplayed(content);
			return;
		}

		const timer = setTimeout(() => {
			lastRenderedAt.current = Date.now();
			setDisplayed(content);
		}, RENDER_INTERVAL_MS - elapsed);
		return () => clearTimeout(timer);
	}, [content, displayed]);

	return displayed;
}

export const MarkdownBody = React.memo(function MarkdownBody({ content }: { content: string }) {
	const markdownStyles = useThemedStyles(createMarkdownStyles);
	const router = useRouter();
	const displayed = useCoalescedContent(content);
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
			rules={sureWordMarkdownRules}
			markdownit={markdownIt}
			onLinkPress={onLinkPress}
			allowedImageHandlers={ALLOWED_IMAGE_HANDLERS}
			defaultImageHandler={DEFAULT_IMAGE_HANDLER}
			topLevelMaxExceededItem={truncationMarker}
		>
			{displayed}
		</MarkdownView>
	);
});

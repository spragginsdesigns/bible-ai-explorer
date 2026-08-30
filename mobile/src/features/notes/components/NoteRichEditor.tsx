import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Asset } from "expo-asset";
import {
	AtkinsonHyperlegible_400Regular,
	AtkinsonHyperlegible_400Regular_Italic,
	AtkinsonHyperlegible_700Bold,
	AtkinsonHyperlegible_700Bold_Italic,
} from "@expo-google-fonts/atkinson-hyperlegible";
import {
	CoreBridge,
	PlaceholderBridge,
	RichText,
	TenTapStartKit,
	Toolbar,
	useBridgeState,
	useEditorBridge,
	useKeyboard,
} from "@10play/tentap-editor";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { NoteSavePayload } from "../types";
import { countWords, htmlToPlainText } from "../utils";
import { GlyphButton } from "./primitives";

const AUTOSAVE_DELAY = 1500;
const BRIDGE_TIMEOUT = 1200;
const hackRegular = require("../../../../assets/fonts/Hack-Regular.ttf");
const hackBold = require("../../../../assets/fonts/Hack-Bold.ttf");
const hackItalic = require("../../../../assets/fonts/Hack-Italic.ttf");
const hackBoldItalic = require("../../../../assets/fonts/Hack-BoldItalic.ttf");

/**
 * TenTap's WebView is a separate document from React Native. Expo's cached
 * Asset local URIs let CSS load the same bundled TTFs without a network hop;
 * the system fallback remains deliberate for the brief pre-cache window.
 */
const fontUri = (source: number) => {
	const asset = Asset.fromModule(source);
	return asset.localUri ?? asset.uri;
};

const cssUri = (uri: string) => uri.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const editorCss = (c: Colors) => `
\t@font-face { font-family: "Hack"; src: url('${cssUri(fontUri(hackRegular))}') format('truetype'); font-style: normal; font-weight: 400; }
\t@font-face { font-family: "Hack"; src: url('${cssUri(fontUri(hackBold))}') format('truetype'); font-style: normal; font-weight: 700; }
\t@font-face { font-family: "Hack"; src: url('${cssUri(fontUri(hackItalic))}') format('truetype'); font-style: italic; font-weight: 400; }
\t@font-face { font-family: "Hack"; src: url('${cssUri(fontUri(hackBoldItalic))}') format('truetype'); font-style: italic; font-weight: 700; }
\t@font-face { font-family: "Atkinson Hyperlegible"; src: url('${cssUri(fontUri(AtkinsonHyperlegible_400Regular))}') format('truetype'); font-style: normal; font-weight: 400; }
\t@font-face { font-family: "Atkinson Hyperlegible"; src: url('${cssUri(fontUri(AtkinsonHyperlegible_700Bold))}') format('truetype'); font-style: normal; font-weight: 700; }
\t@font-face { font-family: "Atkinson Hyperlegible"; src: url('${cssUri(fontUri(AtkinsonHyperlegible_400Regular_Italic))}') format('truetype'); font-style: italic; font-weight: 400; }
\t@font-face { font-family: "Atkinson Hyperlegible"; src: url('${cssUri(fontUri(AtkinsonHyperlegible_700Bold_Italic))}') format('truetype'); font-style: italic; font-weight: 700; }
	html, body {
		background-color: ${c.bgMid};
		margin: 0;
	}
	.ProseMirror {
		background-color: ${c.bgMid};
		color: ${c.text};
		caret-color: ${c.accent};
		font-family: "Atkinson Hyperlegible", sans-serif;
		font-size: 16px;
		line-height: 1.7;
		padding: 16px 18px 120px;
		min-height: 100%;
		-webkit-tap-highlight-color: transparent;
	}
	.ProseMirror:focus { outline: none; }
	.ProseMirror > * + * { margin-top: 0.75em; }
	.ProseMirror p { margin: 0; }
	.ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
		color: #f5f5f5;
		font-weight: 700;
		line-height: 1.3;
		margin: 0;
	}
	.ProseMirror h1 { font-size: 1.6em; }
	.ProseMirror h2 { font-size: 1.35em; }
	.ProseMirror h3 { font-size: 1.15em; }
	.ProseMirror blockquote {
		border-left: 2px solid ${c.accent};
		background-color: ${c.accentSoft};
		border-radius: 0 12px 12px 0;
		padding: 10px 14px;
		margin: 0;
		font-family: Georgia, "Times New Roman", serif;
		font-size: 1.1em;
		color: ${c.textSecondary};
	}
	.ProseMirror a { color: ${c.accent}; text-decoration: underline; }
	.ProseMirror code {
		font-family: "Hack", monospace;
		background-color: ${c.surfaceStrong};
		border-radius: 6px;
		padding: 1px 5px;
		font-size: 0.9em;
	}
	.ProseMirror pre {
		font-family: "Hack", monospace;
		background-color: ${c.surface};
		border: 1px solid ${c.border};
		border-radius: 12px;
		padding: 12px;
	}
	.ProseMirror ul, .ProseMirror ol { padding-left: 1.2em; margin: 0; }
	.ProseMirror li { margin: 0.15em 0; }
	.ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0; }
	.ProseMirror hr { border: none; border-top: 1px solid ${c.borderStrong}; }
	.ProseMirror mark, .highlight-background {
		background-color: rgba(251, 191, 36, 0.25);
		color: #ffffff;
	}
	.ProseMirror ::selection { background-color: rgba(251, 191, 36, 0.3); }
	.ProseMirror p.is-editor-empty:first-child::before {
		color: ${c.textGhost};
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}
`;

const bridgeExtensions = (c: Colors) => [
	...TenTapStartKit,
	CoreBridge.configureCSS(editorCss(c)),
	PlaceholderBridge.configureExtension({
		placeholder: "Start writing your Bible study notes…",
	}),
];

const editorTheme = (c: Colors) => ({
	webview: { backgroundColor: c.bgMid },
	webviewContainer: { backgroundColor: c.bgMid },
	toolbar: {
		toolbarBody: {
			flex: 0,
			flexGrow: 0,
			height: 48,
			minWidth: "100%" as const,
			backgroundColor: c.bgElevated,
			// The surrounding row draws the divider so it spans the extra button too.
			borderTopWidth: 0,
			borderBottomWidth: 0,
			borderTopColor: "transparent",
			borderBottomColor: "transparent",
		},
		toolbarButton: { backgroundColor: "transparent", paddingHorizontal: 5 },
		iconWrapper: { borderRadius: radius.sm, backgroundColor: "transparent", padding: 2 },
		iconWrapperActive: { backgroundColor: c.accentSoft },
		iconWrapperDisabled: { opacity: 0.25 },
		icon: { width: 26, height: 26, tintColor: c.textMuted },
		iconActive: { tintColor: c.accent },
		iconDisabled: { tintColor: c.textGhost },
		linkBarTheme: {
			addLinkContainer: {
				backgroundColor: c.bgElevated,
				borderTopColor: c.borderStrong,
				borderBottomColor: "transparent",
			},
			linkInput: { backgroundColor: c.bgElevated, color: c.text },
			placeholderTextColor: c.textGhost,
			doneButton: { backgroundColor: c.accentSoft },
			doneButtonText: { color: c.accent },
		},
	},
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), ms);
		void promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(null);
			}
		);
	});
}

/**
 * Insert text at the caret from outside the webview.
 *
 * The bundled tentap editor wires only TenTapStartKit and never exposes the
 * tiptap instance on `window`, so there is no editor global to command and a
 * custom bridge would need a custom web build. Text therefore goes in the same
 * way typing does: focus the ProseMirror element and let `execCommand` fire the
 * input events ProseMirror already listens for, which also triggers the normal
 * update -> autosave path. The retry covers the webview not having regained
 * focus yet after a modal closes.
 */
function insertTextScript(text: string): string {
	return `
		(function () {
			var text = ${JSON.stringify(text)};
			var tries = 0;
			function attempt() {
				var el = document.querySelector('.ProseMirror');
				if (el) {
					if (document.activeElement !== el) el.focus();
					if (document.execCommand('insertText', false, text)) return;
				}
				if (++tries < 12) setTimeout(attempt, 60);
			}
			attempt();
		})();
		true;
	`;
}

export interface NoteRichEditorHandle {
	/** Cancel the pending debounce and persist immediately. */
	flush: () => Promise<void>;
	/** Re-seed the document, e.g. after the AI appended to this note. */
	replaceContent: (html: string) => void;
	/** Write text at the caret, restoring focus first. */
	insertText: (text: string) => void;
}

interface NoteRichEditorProps {
	/** Read once on mount - remount (via key) to load a different note. */
	initialHtml: string;
	onSave: (payload: NoteSavePayload) => Promise<void> | void;
	/** Space reserved under the toolbar for the app's floating tab bar. */
	bottomInset: number;
	/** Opens the note picker; the screen inserts the chosen link through the ref. */
	onRequestWikilink: () => void;
}

export const NoteRichEditor = forwardRef<NoteRichEditorHandle, NoteRichEditorProps>(
	function NoteRichEditor({ initialHtml, onSave, bottomInset, onRequestWikilink }, ref) {
		const savedHtmlRef = useRef(initialHtml);
		const latestHtmlRef = useRef(initialHtml);
		const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		const { colors } = useTheme();
		const styles = useThemedStyles(createStyles);
		const extensions = useMemo(() => bridgeExtensions(colors), [colors]);
		const theme = useMemo(() => editorTheme(colors), [colors]);

		const onSaveRef = useRef(onSave);
		onSaveRef.current = onSave;

		const editor = useEditorBridge({
			initialContent: initialHtml,
			avoidIosKeyboard: true,
			bridgeExtensions: extensions,
			theme,
			onChange: () => scheduleSave(),
		});

		// useEditorBridge returns a new object every render; keep one reference so
		// the imperative handle and timers do not churn.
		const editorRef = useRef(editor);
		editorRef.current = editor;

		// Same condition the Toolbar applies to itself, lifted so the wikilink
		// button appears and disappears with it as one bar.
		const editorState = useBridgeState(editor);
		const { isKeyboardUp } = useKeyboard();
		const toolbarHidden = !isKeyboardUp || !editorState.isFocused;

		const persist = useCallback(async (html: string) => {
			if (html === savedHtmlRef.current) return;
			savedHtmlRef.current = html;
			latestHtmlRef.current = html;
			const plainText = htmlToPlainText(html);
			await onSaveRef.current({
				content: html,
				htmlContent: html,
				plainText,
				wordCount: countWords(plainText),
			});
		}, []);

		const capture = useCallback(async () => {
			const html = await withTimeout(editorRef.current.getHTML(), BRIDGE_TIMEOUT);
			if (html === null) return latestHtmlRef.current;
			latestHtmlRef.current = html;
			return html;
		}, []);

		const scheduleSave = useCallback(() => {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				void capture().then(persist);
			}, AUTOSAVE_DELAY);
		}, [capture, persist]);

		const flush = useCallback(async () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			await persist(await capture());
		}, [capture, persist]);

		useImperativeHandle(
			ref,
			() => ({
				flush,
				replaceContent: (html: string) => {
					if (timerRef.current) {
						clearTimeout(timerRef.current);
						timerRef.current = null;
					}
					savedHtmlRef.current = html;
					latestHtmlRef.current = html;
					editorRef.current.setContent(html);
				},
				insertText: (text: string) => {
					if (!text) return;
					// `null` restores the selection the editor held before the sheet
					// took focus, rather than jumping the caret.
					editorRef.current.focus(null);
					editorRef.current.injectJS(insertTextScript(text));
				},
			}),
			[flush]
		);

		// Last-chance save if the screen goes away without an explicit flush.
		useEffect(
			() => () => {
				if (timerRef.current) clearTimeout(timerRef.current);
				void persist(latestHtmlRef.current);
			},
			[persist]
		);

		return (
			<View style={styles.container}>
				<RichText editor={editor} allowFileAccess />
				<View style={[styles.toolbarWrap, { paddingBottom: bottomInset }]}>
					<View style={[styles.toolbarRow, toolbarHidden && styles.toolbarRowHidden]}>
						<GlyphButton
							icon="link-outline"
							accessibilityLabel="Link to a note"
							onPress={onRequestWikilink}
							size={34}
							style={styles.wikilinkButton}
						/>
						<View style={styles.toolbarDivider} />
						{/* The row already mirrors the Toolbar's own hide rule, so it must
						    not hide itself as well and leave the button stranded. */}
						<View style={styles.toolbarFill}>
							<Toolbar editor={editor} hidden={false} />
						</View>
					</View>
				</View>
			</View>
		);
	}
);

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: { flex: 1, backgroundColor: c.bgMid },
		toolbarWrap: { backgroundColor: c.bgMid },
		toolbarRow: {
			flexDirection: "row",
			alignItems: "center",
			backgroundColor: c.bgElevated,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.borderStrong,
		},
		toolbarRowHidden: { display: "none" },
		wikilinkButton: {
			marginLeft: spacing.sm,
			marginRight: spacing.xs,
			backgroundColor: "transparent",
			borderColor: "transparent",
		},
		toolbarDivider: {
			width: StyleSheet.hairlineWidth,
			height: 22,
			marginRight: spacing.xs,
			backgroundColor: c.borderStrong,
		},
		toolbarFill: { flex: 1, minWidth: 0 },
	});

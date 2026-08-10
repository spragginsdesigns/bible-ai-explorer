import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
	CoreBridge,
	PlaceholderBridge,
	RichText,
	TenTapStartKit,
	Toolbar,
	useEditorBridge,
} from "@10play/tentap-editor";
import { radius } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { NoteSavePayload } from "../types";
import { countWords, htmlToPlainText } from "../utils";

const AUTOSAVE_DELAY = 1500;
const BRIDGE_TIMEOUT = 1200;

/**
 * The webview cannot use the app's loaded fonts, so Scripture blockquotes fall
 * back to a system serif. Everything else mirrors the theme tokens.
 */
const editorCss = (c: Colors) => `
	html, body {
		background-color: ${c.bgMid};
		margin: 0;
	}
	.ProseMirror {
		background-color: ${c.bgMid};
		color: ${c.text};
		caret-color: ${c.accent};
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
		background-color: ${c.surfaceStrong};
		border-radius: 6px;
		padding: 1px 5px;
		font-size: 0.9em;
	}
	.ProseMirror pre {
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
			borderTopWidth: StyleSheet.hairlineWidth,
			borderBottomWidth: 0,
			borderTopColor: c.borderStrong,
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

export interface NoteRichEditorHandle {
	/** Cancel the pending debounce and persist immediately. */
	flush: () => Promise<void>;
	/** Re-seed the document, e.g. after the AI appended to this note. */
	replaceContent: (html: string) => void;
}

interface NoteRichEditorProps {
	/** Read once on mount — remount (via key) to load a different note. */
	initialHtml: string;
	onSave: (payload: NoteSavePayload) => Promise<void> | void;
	/** Space reserved under the toolbar for the app's floating tab bar. */
	bottomInset: number;
}

export const NoteRichEditor = forwardRef<NoteRichEditorHandle, NoteRichEditorProps>(
	function NoteRichEditor({ initialHtml, onSave, bottomInset }, ref) {
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
				<RichText editor={editor} />
				<View style={[styles.toolbarWrap, { paddingBottom: bottomInset }]}>
					<Toolbar editor={editor} />
				</View>
			</View>
		);
	}
);

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: { flex: 1, backgroundColor: c.bgMid },
		toolbarWrap: { backgroundColor: c.bgMid },
	});

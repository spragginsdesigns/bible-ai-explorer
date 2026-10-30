import React from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import ts from "typescript";

type Module = Record<string, any>;
function execute(source: string, dependencies: Module): Module {
 const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
 const module = { exports: {} };
 new Function("require", "module", "exports", output)((id: string) => {
  if (id.endsWith(".ttf")) return 1;
  if (!(id in dependencies)) throw new Error("Unexpected fixture dependency " + id);
  return dependencies[id];
 }, module, module.exports);
 return module.exports;
}
const sdk = execute(readFileSync(new URL("../../../node_modules/@10play/tentap-editor/src/RichText/useEditorBridge.tsx", import.meta.url), "utf8"), {
 react: React, "lodash/cloneDeep": (value: unknown) => structuredClone(value),
 "../types/Messaging": { EditorMessageType: { Action: "action" } },
 "./EditorHelper": { EditorHelper: { setEditorLastInstance() {} } },
 "../bridges/StarterKit": { TenTapStartKit: [] }, "../utils": { uniqueBy: (values: unknown[]) => values },
 "./theme": { defaultEditorTheme: {} }, "./utils": { getStyleSheetCSS: () => "" },
 "../utils/mergeThemes": { mergeThemes: (_base: unknown, value: unknown) => value },
 "../utils/misc": { isFabric: () => false }, "react-native": { Platform: { OS: "android" } },
});
let ready = false;
const edits: boolean[] = [];
const colors = {};
const core = { name: "controlled-core", extendEditorInstance: () => ({ setEditable: (value: boolean) => edits.push(value) }) };
const tentap = {
 useEditorBridge: sdk.useEditorBridge, TenTapStartKit: [],
 CoreBridge: { configureCSS: () => core },
 PlaceholderBridge: { configureExtension: () => ({ name: "placeholder" }) },
 useBridgeState: () => ({ isReady: ready, isFocused: false }), useKeyboard: () => ({ isKeyboardUp: false }), Toolbar: () => null,
 RichText: ({ editor }: { editor: { webviewRef: React.RefObject<unknown> } }) => {
  React.useLayoutEffect(() => { editor.webviewRef.current = { postMessage() {}, injectJavaScript() {} }; }, [editor.webviewRef]);
  return React.createElement("SyntheticWebView");
 },
};
const component = execute(readFileSync(new URL("./components/NoteRichEditor.tsx", import.meta.url), "utf8"), {
 react: React,
 "react-native": { StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, View: "View", useWindowDimensions: () => ({ fontScale: 1 }) },
 "expo-asset": { Asset: { fromModule: () => ({ uri: "synthetic-font" }) } },
 "@expo-google-fonts/atkinson-hyperlegible": {},
 "@10play/tentap-editor": tentap, "@/theme": { fonts: {}, radius: {}, spacing: {} },
 "@/features/settings/settingsStore": { useTextScaleFactor: () => 1, useTheme: () => ({ colors }), useThemedStyles: () => ({}) },
 "../utils": { countWords: () => 0, htmlToPlainText: () => "" },
 "../noteSaveController": { createNoteSaveController: () => ({ enqueue: async () => {}, flush: async () => true, replaceContent() {}, lastChance: async () => {} }) },
 "../noteMarkdownExport": { noteDocumentToMarkdown: () => "" },
 "lucide-react-native/icons/link": () => null, "./primitives": { GlyphButton: () => null },
 "./canonicalAdoptionBridge": { createCanonicalAdoptionBridge: () => ({ bridge: { name: "canonical" }, dispose() {} }) },
 "./wikilinkBridge": { createWikilinkBridge: () => ({ name: "wikilink", extendEditorInstance: () => ({ setWikilinkTargets() {} }) }) },
 "../../../../editor-web/generated/editorHtml": { editorHtml: "<html>synthetic</html>" },
});
let root: ReturnType<typeof create> | null = null;
const props = (readOnly: boolean) => ({ readOnly, initialHtml: "<p>canonical note</p>", onSave: async () => {}, onCaptureError() {}, bottomInset: 0, onRequestWikilink() {}, linkTargets: [], onOpenWikilink() {} });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); ready = false; edits.length = 0; });
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });
it("actual NoteRichEditor and installed SDK stay locked through mount, WebView readiness and ref rerender", async () => {
 await act(async () => { root = create(React.createElement(component.NoteRichEditor, props(true))); });
 expect(edits.at(-1)).toBe(false);
 ready = true;
 await act(async () => { root!.update(React.createElement(component.NoteRichEditor, props(true))); });
 expect(edits).not.toContain(true); expect(edits.at(-1)).toBe(false);
 await act(async () => { root!.update(React.createElement(component.NoteRichEditor, props(true))); });
 expect(edits.at(-1)).toBe(false);
});
it("ordinary editable mode stays usable and later lock/unlock transitions remain coherent", async () => {
 await act(async () => { root = create(React.createElement(component.NoteRichEditor, props(false))); });
 expect(edits.at(-1)).toBe(true);
 ready = true; await act(async () => { root!.update(React.createElement(component.NoteRichEditor, props(false))); });
 expect(edits.at(-1)).toBe(true);
 await act(async () => { root!.update(React.createElement(component.NoteRichEditor, props(true))); });
 expect(edits.at(-1)).toBe(false);
 await act(async () => { root!.update(React.createElement(component.NoteRichEditor, props(false))); });
 expect(edits.at(-1)).toBe(true);
});

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	BridgeExtension,
	Decoration,
	DecorationSet,
	Plugin,
	PluginKey,
	sendMessage,
	type EditorState,
} from "@10play/tentap-editor";
import { findWikilinks, wikilinkKey, type WikilinkSpan } from "../src/features/notes/wikilinks";
import {
	WIKILINK_BRIDGE_NAME,
	WikilinkActionType,
	type WikilinkMessage,
} from "../src/features/notes/wikilinkBridgeProtocol";

interface WikilinkPluginState {
	links: WikilinkSpan[];
	/** Lowercased titles and aliases that resolve, pushed from native. */
	targets: Set<string>;
	focused: boolean;
}

type WikilinkMeta = { targets?: string[]; focused?: boolean };

const wikilinkKeyPlugin = new PluginKey<WikilinkPluginState>(WIKILINK_BRIDGE_NAME);

function collectLinks(doc: ProseMirrorNode): WikilinkSpan[] {
	const links: WikilinkSpan[] = [];
	doc.descendants((node, pos) => {
		if (node.isText && node.text) links.push(...findWikilinks(node.text, pos));
	});
	return links;
}

/**
 * Live-preview decorations, like Obsidian's: away from the caret a link reads
 * as a note chip with its brackets hidden; with the caret inside or touching
 * it, the raw `[[...]]` text comes back so it can be edited. Decorations only,
 * so the saved HTML/plainText (and the server's link graph) are untouched.
 */
function buildDecorations(state: EditorState): DecorationSet {
	const plugin = wikilinkKeyPlugin.getState(state);
	if (!plugin || plugin.links.length === 0) return DecorationSet.empty;
	const { from: selFrom, to: selTo } = state.selection;
	const decorations: Decoration[] = [];
	for (const link of plugin.links) {
		const editing = plugin.focused && selFrom <= link.to && selTo >= link.from;
		if (editing) {
			decorations.push(Decoration.inline(link.from, link.to, { class: "wikilink-source" }));
			continue;
		}
		const resolved = plugin.targets.has(wikilinkKey(link.target));
		decorations.push(
			Decoration.inline(link.from, link.labelFrom, { class: "wikilink-hidden" }),
			Decoration.inline(link.labelFrom, link.labelTo, {
				class: resolved ? "wikilink-chip" : "wikilink-chip wikilink-unresolved",
				"data-wikilink-target": link.target,
			}),
			Decoration.inline(link.labelTo, link.to, { class: "wikilink-hidden" })
		);
	}
	return DecorationSet.create(state.doc, decorations);
}

const setFocus = (focused: boolean): WikilinkMeta => ({ focused });

const WikilinkDecoration = Extension.create({
	name: WIKILINK_BRIDGE_NAME,

	addProseMirrorPlugins() {
		return [
			new Plugin<WikilinkPluginState>({
				key: wikilinkKeyPlugin,
				state: {
					init: (_config, state) => ({
						links: collectLinks(state.doc),
						targets: new Set(),
						focused: false,
					}),
					apply: (tr, prev) => {
						const meta = tr.getMeta(wikilinkKeyPlugin) as WikilinkMeta | undefined;
						return {
							links: tr.docChanged ? collectLinks(tr.doc) : prev.links,
							targets: meta?.targets ? new Set(meta.targets) : prev.targets,
							focused: meta?.focused ?? prev.focused,
						};
					},
				},
				props: {
					decorations: buildDecorations,
					handleDOMEvents: {
						focus: (view) => {
							view.dispatch(view.state.tr.setMeta(wikilinkKeyPlugin, setFocus(true)));
							return false;
						},
						blur: (view) => {
							view.dispatch(view.state.tr.setMeta(wikilinkKeyPlugin, setFocus(false)));
							return false;
						},
						// mousedown, not click: ProseMirror moves the caret (and Android
						// raises the keyboard) on mousedown, so a tap that opens a note
						// has to claim the event before that happens.
						mousedown: (view, event) => {
							const el = (event.target as HTMLElement | null)?.closest?.("[data-wikilink-target]");
							const target = el?.getAttribute("data-wikilink-target");
							if (!target) return false;
							const plugin = wikilinkKeyPlugin.getState(view.state);
							// Unresolved: let the caret land so the link can be fixed.
							if (!plugin?.targets.has(wikilinkKey(target))) return false;
							event.preventDefault();
							sendMessage({ type: WikilinkActionType.Open, payload: { target } } as never);
							return true;
						},
					},
				},
			}),
		];
	},
});

export const WikilinkWebBridge = new BridgeExtension<object, object, WikilinkMessage>({
	tiptapExtension: WikilinkDecoration,
	onBridgeMessage: (editor, message) => {
		if (message.type !== WikilinkActionType.SetTargets) return false;
		const meta: WikilinkMeta = { targets: message.payload };
		editor.view.dispatch(
			editor.state.tr.setMeta(wikilinkKeyPlugin, meta).setMeta("addToHistory", false)
		);
		return true;
	},
});

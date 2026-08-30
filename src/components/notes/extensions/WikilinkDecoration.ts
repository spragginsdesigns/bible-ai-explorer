import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// Same shape the server parses out of plainText (src/lib/note-links.ts): the
// body keeps the literal [[...]] text and this extension only *decorates* it,
// so the document, the mobile client, and the server all see identical content.
const WIKILINK_PATTERN = /\[\[([^[\]]+?)\]\]/g;

export interface WikilinkDecorationOptions {
	/**
	 * Resolve a link target to a note id, mirroring the server's rule
	 * (case-insensitive over title + aliases, newest wins). Null = unresolved.
	 * Read through a ref by the caller so the freshest note list is used.
	 */
	resolveTarget: (target: string) => string | null;
	/** Open the resolved note. */
	onOpenNote: (noteId: string) => void;
}

interface DecoratedLink {
	from: number;
	to: number;
	target: string;
}

function targetOf(inner: string): string {
	const hash = inner.indexOf("#");
	const pipe = inner.indexOf("|");
	const cut = Math.min(hash === -1 ? inner.length : hash, pipe === -1 ? inner.length : pipe);
	return inner.slice(0, cut).trim();
}

function findLinks(doc: ProseMirrorNode): DecoratedLink[] {
	const links: DecoratedLink[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return;
		WIKILINK_PATTERN.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = WIKILINK_PATTERN.exec(node.text)) !== null) {
			const target = targetOf(match[1]);
			if (!target) continue;
			links.push({ from: pos + match.index, to: pos + match.index + match[0].length, target });
		}
	});
	return links;
}

const wikilinkKey = new PluginKey<DecorationSet>("wikilinkDecoration");

/**
 * Renders [[wikilinks]] in the note body as real links: resolved targets get
 * the gold .wikilink style and open on click, unresolved ones render dimmed.
 * Decorations only - the underlying text is untouched, so the caret can still
 * enter and edit the link like any other text.
 */
export const WikilinkDecoration = Extension.create<WikilinkDecorationOptions>({
	name: "wikilinkDecoration",

	addOptions() {
		return {
			resolveTarget: () => null,
			onOpenNote: () => {},
		};
	},

	addProseMirrorPlugins() {
		const buildDecorations = (doc: ProseMirrorNode): DecorationSet => {
			const decorations = findLinks(doc).map((link) =>
				Decoration.inline(link.from, link.to, {
					class: this.options.resolveTarget(link.target)
						? "wikilink"
						: "wikilink wikilink-unresolved",
					"data-wikilink-target": link.target,
				})
			);
			return DecorationSet.create(doc, decorations);
		};

		return [
			new Plugin<DecorationSet>({
				key: wikilinkKey,
				state: {
					init: (_config, state) => buildDecorations(state.doc),
					apply: (tr, old) =>
						tr.docChanged ? buildDecorations(tr.doc) : old.map(tr.mapping, tr.doc),
				},
				props: {
					decorations(state) {
						return wikilinkKey.getState(state) ?? null;
					},
					// mousedown, not click: ProseMirror moves the selection on
					// mousedown, so by click time the caret jump has already
					// repainted and the navigation feels like a misfire.
					handleDOMEvents: {
						mousedown: (_view, event) => {
							const el = (event.target as HTMLElement | null)?.closest?.(
								"[data-wikilink-target]"
							);
							if (!el) return false;
							const target = el.getAttribute("data-wikilink-target");
							if (!target) return false;
							const noteId = this.options.resolveTarget(target);
							if (!noteId) return false; // unresolved: let the caret land normally
							event.preventDefault();
							this.options.onOpenNote(noteId);
							return true;
						},
					},
				},
			}),
		];
	},
});

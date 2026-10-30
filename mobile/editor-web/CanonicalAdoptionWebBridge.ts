import { BridgeExtension } from "@10play/tentap-editor";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { CANONICAL_ADOPTION_BRIDGE, adoptCanonicalDocument, type CanonicalAdoptionMessage } from "../src/features/notes/canonicalAdoptionProtocol";

/** One editor callback applies, structurally checks and acknowledges the same request. */
export const CanonicalAdoptionWebBridge = new BridgeExtension<object, object, CanonicalAdoptionMessage>({
	forceName: CANONICAL_ADOPTION_BRIDGE,
	onBridgeMessage: (editor, message, send) => {
		if (message.type !== "replace-canonical-note") return false;
		const { requestId, html } = message.payload;
		try {
			const dom = new window.DOMParser().parseFromString(html, "text/html");
			const expected = ProseMirrorDOMParser.fromSchema(editor.schema).parse(dom.body).toJSON();
			const result = adoptCanonicalDocument(expected,
				() => { editor.commands.setContent(html); }, () => editor.getJSON(), () => editor.getHTML());
			send({ type: "canonical-note-replaced", payload: { requestId, ...result } });
		} catch { send({ type: "canonical-note-replaced", payload: { requestId, matched: false } }); }
		return true;
	},
});

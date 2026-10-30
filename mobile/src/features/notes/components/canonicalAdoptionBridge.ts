import { BridgeExtension } from "@10play/tentap-editor";
import { CANONICAL_ADOPTION_BRIDGE, type CanonicalAdoptionMessage, type CanonicalAdoptionResult } from "../canonicalAdoptionProtocol";
export interface CanonicalAdoptionEditorInstance { replaceCanonicalNote: (html: string) => Promise<CanonicalAdoptionResult> }
let nextRequest = 0;
export function createCanonicalAdoptionBridge() {
	const pending = new Map<string, { finish: (result: CanonicalAdoptionResult) => void; timer: ReturnType<typeof setTimeout> }>();
	const bridge = new BridgeExtension<object, CanonicalAdoptionEditorInstance, CanonicalAdoptionMessage>({
		forceName: CANONICAL_ADOPTION_BRIDGE,
		onEditorMessage: message => {
			if (message.type !== "canonical-note-replaced") return false;
			const request = pending.get(message.payload.requestId);
			if (!request) return true;
			pending.delete(message.payload.requestId); clearTimeout(request.timer);
			request.finish(message.payload.matched === true && typeof message.payload.html === "string" ? { matched: true, html: message.payload.html } : { matched: false });
			return true;
		},
		extendEditorInstance: send => ({
			replaceCanonicalNote: html => new Promise(resolve => {
				const requestId = `canonical-${Date.now()}-${++nextRequest}`;
				const timer = setTimeout(() => { pending.delete(requestId); resolve({ matched: false }); }, 1200);
				pending.set(requestId, { finish: resolve, timer });
				try { send({ type: "replace-canonical-note", payload: { requestId, html } }); }
				catch { clearTimeout(timer); pending.delete(requestId); resolve({ matched: false }); }
			}),
		}),
	});
	return { bridge, dispose: () => { for (const request of pending.values()) { clearTimeout(request.timer); request.finish({ matched: false }); } pending.clear(); } };
}

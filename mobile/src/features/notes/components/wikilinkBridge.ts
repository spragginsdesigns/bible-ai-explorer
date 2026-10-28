import { BridgeExtension } from "@10play/tentap-editor";
import {
	WIKILINK_BRIDGE_NAME,
	WikilinkActionType,
	type WikilinkMessage,
} from "../wikilinkBridgeProtocol";

export interface WikilinkEditorInstance {
	/** Tell the editor which lowercased titles/aliases resolve, so it can dim the rest. */
	setWikilinkTargets: (keys: string[]) => void;
}

/**
 * Native half of the wikilink bridge. The tiptap plugin itself lives in the
 * custom editor bundle (editor-web/WikilinkWebBridge.ts); this side only names
 * the bridge so TenTap enables it there, and carries messages both ways.
 */
export function createWikilinkBridge(onOpen: (target: string) => void) {
	return new BridgeExtension<object, WikilinkEditorInstance, WikilinkMessage>({
		forceName: WIKILINK_BRIDGE_NAME,
		onEditorMessage: (message) => {
			if (message.type !== WikilinkActionType.Open) return false;
			onOpen(message.payload.target);
			return true;
		},
		extendEditorInstance: (sendBridgeMessage) => ({
			setWikilinkTargets: (keys) =>
				sendBridgeMessage({ type: WikilinkActionType.SetTargets, payload: keys }),
		}),
	});
}

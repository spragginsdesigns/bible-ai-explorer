import React from "react";
import { createRoot } from "react-dom/client";
import { EditorContent } from "@tiptap/react";
import { TenTapStartKit, useTenTap } from "@10play/tentap-editor";
import { WikilinkWebBridge } from "./WikilinkWebBridge";

declare global {
	interface Window {
		contentInjected: boolean | undefined;
	}
}

// TenTap's simple editor plus the wikilink bridge. useTenTap drops any bridge
// the native side did not register, exactly as the stock bundle does.
const bridges = [...TenTapStartKit, WikilinkWebBridge];

function Tiptap() {
	const editor = useTenTap({ bridges });
	return <EditorContent editor={editor} className={window.dynamicHeight ? "dynamic-height" : undefined} />;
}

// Android's WebView can inject the native config after load, so wait for it
// before rendering, like TenTap's own entry point does.
const interval = setInterval(() => {
	if (!window.contentInjected) return;
	clearInterval(interval);
	createRoot(document.getElementById("root")!).render(<Tiptap />);
}, 1);

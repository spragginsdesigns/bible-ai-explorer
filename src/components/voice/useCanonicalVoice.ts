"use client";

import { useEffect, useRef, useState } from "react";
import { beginNarration } from "@/lib/voice/web-narration";
import { savedVoiceAnswer } from "@/lib/voice/web-saved-answer";
import { useVoiceControls, useVoiceControlsActive } from "./VoiceControlProvider";

/** Read ordinary Chat only after the owned history API confirms the saved row. */
export function useCanonicalVoice(conversationId: string | null, messages: readonly {
	id: string; role: string; content: string; isStreaming?: boolean;
}[], busy: boolean, welcome: boolean): boolean {
	const controls = useVoiceControls();
	const active = useVoiceControlsActive();
	const speak = controls?.speak;
	const stop = controls?.stop;
	const heard = useRef(new Set<string>());
	const [verifiedId, setVerifiedId] = useState<string | null>(null);
	const last = messages.at(-1);
	const messageId = last?.role === "assistant" && !last.isStreaming ? last.id : null;
	useEffect(() => { if (!active) { heard.current.clear(); setVerifiedId(null); } }, [active]);
	useEffect(() => {
		if (!active || busy || !conversationId || !messageId || !speak || !stop) return;
		if (heard.current.has(messageId)) { setVerifiedId(messageId); return; }
		const request = new AbortController();
		const release = beginNarration();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let interrupted = false;
		void (async () => {
			try {
				for (let attempt = 0; attempt < 4; attempt += 1) {
					const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { cache: "no-store", signal: request.signal });
					if (request.signal.aborted) return;
					if (!response.ok) throw new Error("Saved answer unavailable");
					const text = savedVoiceAnswer(await response.json(), messageId);
					if (request.signal.aborted) return;
					if (text !== null) {
						if (!welcome && text.trim() && !heard.current.has(messageId)) await speak(text);
						if (!request.signal.aborted) { heard.current.add(messageId); setVerifiedId(messageId); }
						return;
					}
					if (attempt < 3) await new Promise<void>(resolve => { timer = setTimeout(resolve, 750); });
				}
				throw new Error("Answer not saved yet");
			} catch {
				if (!request.signal.aborted) {
					stop();
					await speak("I could not confirm your answer was saved. Voice controls stopped. Check Chat before repeating the question.");
				}
			} finally { if (!interrupted) release(); }
		})();
		return () => { interrupted = true; request.abort(); if (timer) clearTimeout(timer); release(); };
	}, [active, welcome, busy, conversationId, messageId, speak, stop]);
	return !active || messages.length === 0 || (messageId !== null && verifiedId === messageId);
}

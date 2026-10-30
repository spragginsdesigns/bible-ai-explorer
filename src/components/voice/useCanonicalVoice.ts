"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { beginNarration } from "@/lib/voice/web-narration";
import { savedVoiceAnswer, voiceAnswerEnvelope } from "@/lib/voice/web-saved-answer";
import { dbMessageToUIMessage, toViewMessage } from "../useChat";
import { useVoiceControls, useVoiceControlsActive } from "./VoiceControlProvider";

/** Read ordinary Chat only after the owned history API confirms the saved row. */
export function useCanonicalVoice(conversationId: string | null, messages: readonly {
	id: string; role: string; content: string; isStreaming?: boolean; choiceCard?: unknown; historyVerification?: unknown;
}[], busy: boolean, welcome: boolean): boolean {
	const { userId, sessionId } = useAuth();
	const mounted = useRef<object | null>(null);
	useLayoutEffect(() => {
		const owner = {}; mounted.current = owner;
		return () => { if (mounted.current === owner) mounted.current = null; };
	}, []);
	const controls = useVoiceControls();
	const active = useVoiceControlsActive();
	const speak = controls?.speak;
	const stop = controls?.stop;
	const heard = useRef(new WeakSet<object>());
	const [verified, setVerified] = useState<{ key: string; lifecycle: object } | null>(null);
	const last = messages.at(-1);
	const messageId = last?.role === "assistant" && !last.isStreaming ? last.id : null;
	const envelope = messageId ? voiceAnswerEnvelope(last) : null;
	const key = userId && sessionId && conversationId && messageId && envelope !== null ? JSON.stringify([userId, sessionId, conversationId, messageId, envelope]) : null;
	const current = useRef({ key, active, busy, welcome });
	if (current.current.key !== key || current.current.active !== active || current.current.busy !== busy || current.current.welcome !== welcome) current.current = { key, active, busy, welcome };
	const lifecycle = current.current;
	useEffect(() => { if (!active) { heard.current = new WeakSet(); setVerified(null); } }, [active]);
	useEffect(() => {
		const mountOwner = mounted.current;
		if (!mountOwner || !active || busy || !conversationId || !messageId || !speak || !stop) return;
		if (!key || envelope === null) { stop(); void speak("I could not confirm your answer was saved. Voice controls stopped. Check Chat before repeating the question."); return; }
		if (heard.current.has(lifecycle)) { setVerified({ key, lifecycle }); return; }
		const request = new AbortController();
		const isCurrent = () => mounted.current === mountOwner && current.current === lifecycle && lifecycle.active && !lifecycle.busy && !request.signal.aborted;
		const release = beginNarration();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let interrupted = false;
		void (async () => {
			try {
				for (let attempt = 0; attempt < 4; attempt += 1) {
					const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { cache: "no-store", signal: request.signal });
					if (!isCurrent()) return;
					if (!response.ok) throw new Error("Saved answer unavailable");
					const text = savedVoiceAnswer(await response.json(), messageId, envelope, row => toViewMessage(dbMessageToUIMessage(row), { isStreaming: false }));
					if (!isCurrent()) return;
					if (text !== null) {
						if (!welcome && text.trim() && !heard.current.has(lifecycle)) await speak(text);
						if (isCurrent()) { heard.current.add(lifecycle); setVerified({ key, lifecycle }); }
						return;
					}
					if (attempt < 3) await new Promise<void>(resolve => { timer = setTimeout(resolve, 750); });
				}
				throw new Error("Answer not saved yet");
			} catch {
				if (isCurrent()) {
					stop();
					await speak("I could not confirm your answer was saved. Voice controls stopped. Check Chat before repeating the question.");
				}
			} finally { if (!interrupted) release(); }
		})();
		return () => { interrupted = true; request.abort(); if (timer) clearTimeout(timer); release(); };
	}, [active, welcome, busy, conversationId, messageId, key, envelope, lifecycle, speak, stop]);
	return !active || messages.length === 0 || (key !== null && verified?.key === key && verified.lifecycle === lifecycle);
}

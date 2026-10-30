"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { ChoiceCardOutput } from "@/lib/onboarding-rules";
import { alreadyHeardOnStart, voiceItemsFor, type VoiceItem } from "@/lib/guide-cards";
import { beginNarration, WEB_VOICE_RATE } from "@/lib/voice/web-narration";
import { useVoiceControls, useVoiceControlsActive } from "../voice/VoiceControlProvider";
import { requestWelcomeVoice, type WelcomeVoiceAnswer } from "@/lib/walk-client";

/** A message is saved right after its stream ends, so a 404 just after is expected. */
const NOT_SAVED_RETRIES = 4;
const NOT_SAVED_DELAY_MS = 750;

interface VoiceMessage {
	id: string;
	role: "user" | "assistant";
	isStreaming?: boolean;
	choiceCard?: ChoiceCardOutput;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One queue of things to read, played strictly one after another. Every
 * start and stop bumps `session`, and any step still in flight from an older
 * session gives up the moment it notices.
 */
class WelcomeVoicePlayer {
	constructor(private readonly onUnavailable: () => void) {}
	private heard = new Set<string>();
	private queue: VoiceItem[] = [];
	private playing = false;
	private session = 0;
	private ownsSession: () => boolean = () => false;
	private request: AbortController | null = null;
	private stopCurrent: (() => void) | null = null;
	private releaseNarration: (() => void) | null = null;

	start(alreadyHeard: readonly string[], ownsSession: () => boolean): void {
		this.stop();
		this.ownsSession = ownsSession;
		this.request = new AbortController();
		this.heard = new Set(alreadyHeard);
	}

	stop(): void {
		this.session += 1;
		this.request?.abort();
		this.request = null;
		this.queue = [];
		this.playing = false;
		this.stopCurrent?.();
		this.stopCurrent = null;
		this.releaseNarration?.();
		this.releaseNarration = null;
	}

	/** Queue every settled message not read yet, and play. */
	offer(messages: readonly VoiceMessage[]): void {
		if (!this.ownsSession()) return;
		for (const message of messages) {
			if (message.role !== "assistant" || message.isStreaming || message.id === "pending-assistant") continue;
			if (this.heard.has(message.id)) continue;
			this.heard.add(message.id);
			this.queue.push(...voiceItemsFor(message));
		}
		void this.pump();
	}

	private isCurrent(session: number): boolean { return this.session === session && this.ownsSession(); }

	private async pump(): Promise<void> {
		if (this.playing) return;
		const session = this.session;
		this.playing = true;
		const release = beginNarration("welcome");
		this.releaseNarration = release;
		try {
			while (this.isCurrent(session)) {
				const item = this.queue.shift();
				if (!item) break;
				const answer = await this.fetchAnswer(item, session);
				if (!answer && this.isCurrent(session) && "messageId" in item) { this.stop(); this.onUnavailable(); return; }
				if (answer && this.isCurrent(session)) await this.speak(answer, session);
			}
		} finally {
			release();
			if (this.session === session) { this.playing = false; this.releaseNarration = null; }
		}
	}

	private async fetchAnswer(item: VoiceItem, session: number): Promise<WelcomeVoiceAnswer | null> {
		const attempts = "messageId" in item ? NOT_SAVED_RETRIES : 1;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			if (!this.isCurrent(session)) return null;
			try {
				const answer = await requestWelcomeVoice(item, this.request?.signal);
				if (!this.isCurrent(session)) return null;
				if (answer) return answer;
			} catch {
				// A narration that fails to prepare is skipped, never retried into a loop.
				return null;
			}
			if (attempt < attempts - 1) await wait(NOT_SAVED_DELAY_MS);
		}
		return null;
	}

	private speak(answer: WelcomeVoiceAnswer, session: number): Promise<void> {
		return new Promise<void>((resolve) => {
			if (!this.isCurrent(session)) {
				resolve();
				return;
			}
			const done = () => {
				if (this.session === session) this.stopCurrent = null;
				resolve();
			};
			const failed = () => {
				done();
				if (this.isCurrent(session)) { this.stop(); this.onUnavailable(); }
			};
			if (answer.status === "ready") {
				const audio = new Audio(answer.streamUrl);
				audio.playbackRate = WEB_VOICE_RATE;
				audio.preservesPitch = true;
				audio.onended = done;
				audio.onerror = failed;
				this.stopCurrent = () => {
					audio.pause();
					audio.removeAttribute("src");
					audio.load();
					done();
				};
				// A browser that refuses to start sound without a tap skips this one.
				audio.play().catch(failed);
				return;
			}
			if (!("speechSynthesis" in window) || !answer.text.trim()) {
				done();
				return;
			}
			const utterance = new SpeechSynthesisUtterance(answer.text);
			utterance.rate = WEB_VOICE_RATE;
			utterance.pitch = 1;
			utterance.onend = done;
			utterance.onerror = failed;
			this.stopCurrent = () => {
				window.speechSynthesis.cancel();
				done();
			};
			window.speechSynthesis.speak(utterance);
		});
	}
}

/**
 * Voice mode ("Read it to me") for the welcome conversation
 * (docs/onboarding/PLAN.md). While `active`, each of SureWord's new messages
 * is read aloud once it has settled, then its card's scripted question. The
 * server picks the voice: a shared or generated narration streamed from our
 * own origin (`ready`), or the words for the browser's own free voice
 * (`device`).
 *
 * Starting (switched on, or the welcome opened with it on) reads the newest
 * message and counts the rest as heard. Switching it off or leaving the
 * conversation stops whatever is playing and drops the queue.
 */
export function useWelcomeVoice(active: boolean, conversationId: string | null, messages: readonly VoiceMessage[]): void {
	const { userId, sessionId, isLoaded } = useAuth();
	const ownerKey = isLoaded && userId && sessionId && active ? JSON.stringify([userId, sessionId, conversationId]) : null;
	const owner = useRef({ key: ownerKey });
	// Invalidate held output before the effect's stop/abort can run.
	if (owner.current.key !== ownerKey) owner.current = { key: ownerKey };
	const identity = owner.current;
	const controls = useVoiceControls();
	const controlsActive = useVoiceControlsActive();
	const unavailable = useRef(() => {});
	unavailable.current = () => {
		if (!controlsActive || !controls) return;
		controls.stop();
		void controls.speak("I could not read the saved welcome answer. Voice controls stopped. Check Chat before repeating your choice.");
	};
	const [player] = useState(() => new WelcomeVoicePlayer(() => unavailable.current()));
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	useLayoutEffect(() => {
		if (!active || !ownerKey) return;
		player.start(alreadyHeardOnStart(messagesRef.current), () => owner.current === identity);
		return () => player.stop();
	}, [active, conversationId, ownerKey, identity, player]);

	useEffect(() => {
		if (active && ownerKey && document.visibilityState === "visible") player.offer(messages);
	}, [active, messages, ownerKey, identity, player]);
	useEffect(() => {
		const hidden = () => { if (document.visibilityState !== "visible") player.stop(); };
		document.addEventListener("visibilitychange", hidden);
		window.addEventListener("pagehide", hidden);
		return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", hidden); };
	}, [player]);
}

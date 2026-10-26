"use client";

import { useEffect, useRef, useState } from "react";
import type { ChoiceCardOutput } from "@/lib/onboarding-rules";
import { alreadyHeardOnStart, voiceItemsFor, type VoiceItem } from "@/lib/guide-cards";
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
	private heard = new Set<string>();
	private queue: VoiceItem[] = [];
	private playing = false;
	private session = 0;
	private stopCurrent: (() => void) | null = null;

	start(alreadyHeard: readonly string[]): void {
		this.stop();
		this.heard = new Set(alreadyHeard);
	}

	stop(): void {
		this.session += 1;
		this.queue = [];
		this.playing = false;
		this.stopCurrent?.();
		this.stopCurrent = null;
	}

	/** Queue every settled message not read yet, and play. */
	offer(messages: readonly VoiceMessage[]): void {
		for (const message of messages) {
			if (message.role !== "assistant" || message.isStreaming || message.id === "pending-assistant") continue;
			if (this.heard.has(message.id)) continue;
			this.heard.add(message.id);
			this.queue.push(...voiceItemsFor(message));
		}
		void this.pump();
	}

	private async pump(): Promise<void> {
		if (this.playing) return;
		const session = this.session;
		this.playing = true;
		try {
			while (this.session === session) {
				const item = this.queue.shift();
				if (!item) break;
				const answer = await this.fetchAnswer(item, session);
				if (answer && this.session === session) await this.speak(answer, session);
			}
		} finally {
			if (this.session === session) this.playing = false;
		}
	}

	private async fetchAnswer(item: VoiceItem, session: number): Promise<WelcomeVoiceAnswer | null> {
		const attempts = "messageId" in item ? NOT_SAVED_RETRIES : 1;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			if (this.session !== session) return null;
			try {
				const answer = await requestWelcomeVoice(item);
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
			if (this.session !== session) {
				resolve();
				return;
			}
			const done = () => {
				this.stopCurrent = null;
				resolve();
			};
			if (answer.status === "ready") {
				const audio = new Audio(answer.streamUrl);
				audio.onended = done;
				audio.onerror = done;
				this.stopCurrent = () => {
					audio.pause();
					audio.removeAttribute("src");
					audio.load();
					done();
				};
				// A browser that refuses to start sound without a tap skips this one.
				audio.play().catch(done);
				return;
			}
			if (!("speechSynthesis" in window) || !answer.text.trim()) {
				done();
				return;
			}
			const utterance = new SpeechSynthesisUtterance(answer.text);
			utterance.onend = done;
			utterance.onerror = done;
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
	const [player] = useState(() => new WelcomeVoicePlayer());
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	useEffect(() => {
		if (!active) return;
		player.start(alreadyHeardOnStart(messagesRef.current));
		return () => player.stop();
	}, [active, conversationId, player]);

	useEffect(() => {
		if (active) player.offer(messages);
	}, [active, messages, player]);
}

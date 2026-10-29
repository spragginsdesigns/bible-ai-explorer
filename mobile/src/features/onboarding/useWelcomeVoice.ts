import { useEffect, useRef } from "react";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { API_URL, apiJson, boundedToken, type GetToken } from "@/lib/api";
import { requestVoice, type OnboardingVoiceAnswer } from "./api";
import { heardOnEnable, takeUnheard, type VoiceItem, type VoiceMessage } from "./voiceQueue";
import type { OnboardingStep } from "./onboardingRules";
import { acquireVoiceOutput, reportVoiceFailure } from "@/features/voice/voiceActivity";
import { VOICE_PLAYBACK_RATE } from "@/features/voice/voiceCommands";
import { waitForSavedVoiceReply } from "@/features/voice/savedVoiceReply";

/** A reply is saved just after its stream ends, so its audio can 404 for a moment. */
const NOT_SAVED_RETRIES = 4;
const NOT_SAVED_DELAY_MS = 900;
/** Narration that has not advanced for this long is given up on. */
const STALL_MS = 12_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Voice mode for the welcome conversation: reads each new SureWord message
 * aloud, then the card's question, one at a time. The server decides between
 * the Listen narrator (ElevenLabs, cached) and free on-device speech
 * (`expo-speech`) when narration is off, unconfigured, over the account's
 * ceiling or failed; this hook only plays what it is told.
 */
export function useWelcomeVoice(options: {
	enabled: boolean;
	messages: readonly VoiceMessage[];
	getToken: GetToken;
	deviceOnly?: boolean;
	conversationId?: string | null;
	sessionKey?: string;
}) {
	const { enabled, messages, getToken, deviceOnly = false } = options;
	const deviceOnlyRef = useRef(deviceOnly);
	deviceOnlyRef.current = deviceOnly;
	const conversationRef = useRef(options.conversationId);
	conversationRef.current = options.conversationId;
	const heard = useRef<Set<string> | null>(null);
	const queue = useRef<VoiceItem[]>([]);
	const running = useRef(false);
	const generation = useRef(0);
	const player = useRef<AudioPlayer | null>(null);
	const cancelPlayback = useRef<(() => void) | null>(null);
	const getTokenRef = useRef(getToken);
	getTokenRef.current = getToken;

	const stopAll = () => {
		generation.current += 1;
		queue.current = [];
		running.current = false;
		cancelPlayback.current?.();
		cancelPlayback.current = null;
		player.current?.remove();
		player.current = null;
		void Speech.stop();
	};

	useEffect(() => { heard.current = null; stopAll(); }, [options.sessionKey]);
	useEffect(() => {
		if (!enabled) {
			heard.current = null;
			stopAll();
			return;
		}
		if (!heard.current) heard.current = heardOnEnable(messages);
		queue.current.push(...takeUnheard(messages, heard.current));
		void drain();
		// drain reads refs only; messages is the trigger.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, messages, options.sessionKey]);

	useEffect(() => stopAll, []);

	async function answerFor(item: VoiceItem, run: number): Promise<OnboardingVoiceAnswer | null> {
		if (deviceOnlyRef.current && "messageId" in item && item.text) {
			const conversationId = conversationRef.current;
			if (!conversationId) throw new Error("The conversation is not saved yet. Voice controls stopped.");
			await waitForSavedVoiceReply({ messageId: item.messageId, read: () => apiJson(getTokenRef.current, `/api/conversations/${conversationId}`), isCurrent: () => run === generation.current && conversationRef.current === conversationId });
			return { status: "device", text: item.text, reason: "device", characters: item.text.length };
		}
		const request = "messageId" in item ? { messageId: item.messageId } : { step: item.step as OnboardingStep };
		for (let attempt = 0; attempt <= NOT_SAVED_RETRIES; attempt += 1) {
			const answer = await requestVoice(getTokenRef.current, request).catch(() => null);
			if (answer || run !== generation.current || !("messageId" in item)) return answer;
			await wait(NOT_SAVED_DELAY_MS);
		}
		return null;
	}

	async function play(answer: OnboardingVoiceAnswer, run: number): Promise<void> {
		if (answer.status === "device") {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => { void Speech.stop(); cancelPlayback.current = null; reject(new Error("Spoken answer did not finish.")); }, 180_000);
				const finish = () => { clearTimeout(timeout); cancelPlayback.current = null; resolve(); };
				cancelPlayback.current = finish;
				Speech.speak(answer.text, { rate: VOICE_PLAYBACK_RATE, onDone: finish, onStopped: finish, onError: () => { clearTimeout(timeout); cancelPlayback.current = null; reject(new Error("Could not read the answer aloud.")); } });
			});
			return;
		}
		const token = await boundedToken(getTokenRef.current, true, answer.streamUrl).catch(() => null);
		if (run !== generation.current) return;
		await new Promise<void>((resolve) => {
			const next = createAudioPlayer({
				uri: `${API_URL}${answer.streamUrl}`,
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
			next.shouldCorrectPitch = true;
			next.setPlaybackRate(VOICE_PLAYBACK_RATE, "high");
			player.current = next;
			let done = false;
			let lastTime = -1;
			let lastProgressAt = Date.now();
			const finish = () => {
				if (done) return;
				done = true;
				clearInterval(watchdog);
				subscription.remove();
				if (player.current === next) player.current = null;
				next.remove();
				cancelPlayback.current = null;
				resolve();
			};
			cancelPlayback.current = finish;
			const subscription = next.addListener("playbackStatusUpdate", (status) => {
				if (status.didJustFinish || run !== generation.current) return finish();
				if (status.currentTime !== lastTime) {
					lastTime = status.currentTime;
					lastProgressAt = Date.now();
				}
			});
			// A stream that fails or stalls never reports didJustFinish, and the
			// queue would wait on it for the rest of the session.
			const watchdog = setInterval(() => {
				if (run !== generation.current) finish();
				else if (Date.now() - lastProgressAt > STALL_MS) { reportVoiceFailure("Spoken playback stalled. Voice controls stopped. Tap Start voice controls to retry."); finish(); }
			}, 1000);
			next.play();
		});
	}

	async function drain(): Promise<void> {
		if (running.current) return;
		running.current = true;
		const run = generation.current;
		const output = acquireVoiceOutput();
		try {
			await output.microphoneStopped;
			while (queue.current.length > 0 && run === generation.current) {
				const item = queue.current.shift();
				if (!item) break;
				if (deviceOnlyRef.current && "step" in item) continue;
				const answer = await answerFor(item, run);
				if (!answer && run === generation.current) throw new Error("The answer is not saved yet. Voice controls stopped. Tap Start voice controls to retry.");
				if (answer && run === generation.current) await play(answer, run);
			}
		} catch (error) {
			if (run === generation.current) reportVoiceFailure(error instanceof Error ? error.message : "Spoken playback failed. Voice controls stopped.");
		} finally {
			if (run === generation.current) running.current = false;
			output.release();
		}
	}
}

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { usePathname, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import type { ExpoSpeechRecognitionModuleType } from "expo-speech-recognition/build/ExpoSpeechRecognitionModule.types";
import { AppText } from "@/components/AppText";
import { apiJson } from "@/lib/api";
import { afterTabDepartureGuard } from "@/lib/tabDeparture";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme } from "@/features/settings/settingsStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { acquireVoiceOutput, registerMicrophonePause, subscribeVoiceFailure, subscribeVoiceOutput, voiceOutputActive } from "./voiceActivity";
import { VoiceTurnGate, voiceControlsEligible } from "./voiceTurnGate";
import { resolveVoiceCommand, VOICE_PLAYBACK_RATE } from "./voiceCommands";

export interface VoiceCard {
	question: string;
	options: readonly string[];
	allowOther?: boolean;
	choose: (label: string) => void | Promise<void>;
	ask?: (text: string) => void | Promise<void>;
}
export interface VoiceChat {
	busy: boolean;
	error: string | null;
	send: (text: string) => Promise<void>;
}
interface Controls {
	eligible: boolean;
	enabled: boolean;
	status: string;
	start: () => void;
	finish: () => void;
	stop: () => void;
	speak: (text: string) => Promise<void>;
	registerCard: (card: VoiceCard) => () => void;
	registerChat: (chat: VoiceChat) => () => void;
}
const Context = createContext<Controls | null>(null);
const paths = { today: "/today", bible: "/bible", chat: "/", connections: "/connections", study: "/study", notes: "/study/notes", settings: "/settings" } as const;

/** Root scoped: a tab change must not destroy the microphone controls. */
export function VoiceControlProvider({ children }: { children: React.ReactNode }) {
	const { userId, isSignedIn } = useAuth();
	const getToken = useStableGetToken();
	const router = useRouter();
	const path = usePathname();
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const [eligibleAccount, setEligibleAccount] = useState<string | null>(null);
	const eligible = eligibleAccount !== null && eligibleAccount === userId;
	const [enabled, setEnabled] = useState(false);
	const [status, setStatus] = useState("Voice controls off.");
	const currentAccount = useRef(userId);
	currentAccount.current = userId;
	const state = useRef({ enabled: false, requesting: false, permission: false, prompting: false, command: false, cue: false, active: false, epoch: 0, path, foreground: AppState.currentState === "active" });
	state.current.path = path;
	const gate = useRef(new VoiceTurnGate()).current;
	const cardRef = useRef<{ path: string; card: VoiceCard } | null>(null);
	const chatRef = useRef<{ path: string; chat: VoiceChat } | null>(null);
	const recognizer = useRef<ExpoSpeechRecognitionModuleType | null>(null);
	const subscriptions = useRef<{ remove: () => void }[]>([]);
	const endWaiters = useRef<(() => void)[]>([]);
	const turn = useRef<ReturnType<VoiceTurnGate["begin"]> | null>(null);
	const pending = useRef<{ text: string; scope: unknown; changed?: boolean } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const activeCard = () => cardRef.current?.path === state.current.path ? cardRef.current.card : null;
	const activeChat = () => chatRef.current?.path === state.current.path ? chatRef.current.chat : null;
	const scope = () => activeCard() ?? activeChat() ?? state.current.path;
	const blocked = () => !state.current.enabled || !state.current.foreground || state.current.permission || state.current.command || voiceOutputActive() || Boolean(activeChat()?.busy);

	const abortMicrophone = useCallback(async () => {
		gate.invalidate();
		pending.current = null;
		if (timer.current) clearTimeout(timer.current);
		if (!state.current.active) return;
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = () => { if (settled) return; settled = true; clearTimeout(timeout); resolve(); };
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error("The microphone did not stop. Restart voice controls."));
			}, 2500);
			endWaiters.current.push(finish);
			try { recognizer.current?.abort(); } catch { finish(); }
		});
	}, [gate]);

	const stop = useCallback(() => {
		const ownSpeech = state.current.enabled || state.current.requesting || state.current.cue;
		state.current.enabled = false;
		state.current.epoch += 1;
		state.current.requesting = false;
		setEnabled(false);
		setStatus("Voice controls off. Tap Start voice controls to listen again.");
		void abortMicrophone().catch(() => undefined);
		if (ownSpeech) void Speech.stop();
	}, [abortMicrophone]);

	async function say(text: string) {
		const epoch = state.current.epoch;
		const output = acquireVoiceOutput();
		try {
			await output.microphoneStopped;
			if (!state.current.foreground || epoch !== state.current.epoch) return;
			state.current.cue = true;
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => { void Speech.stop(); reject(new Error("Spoken guidance did not finish.")); }, 60_000);
				const finish = () => { clearTimeout(timeout); resolve(); };
			Speech.speak(text, { rate: VOICE_PLAYBACK_RATE, onDone: finish, onStopped: finish, onError: () => { clearTimeout(timeout); reject(new Error("Could not speak the guidance.")); } });
			});
		} finally { state.current.cue = false; output.release(); }
	}
	function fail(message: string) {
		stop();
		setStatus(message);
		// Recognition is disabled before recovery speech, so its own error cannot be a command.
		void say(message).catch(() => undefined);
	}
	function schedule() {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(async () => {
			if (blocked() || state.current.active || !recognizer.current) return;
			if (activeChat()?.error) return fail(activeChat()?.error ?? "The last answer failed. Voice controls stopped.");
			const epoch = state.current.epoch;
			state.current.command = true;
			try { await say("Listening."); }
			catch { if (epoch === state.current.epoch) fail("Could not speak the listening cue. Voice controls stopped."); }
			finally { state.current.command = false; }
			if (epoch !== state.current.epoch || blocked() || state.current.active) return;
			turn.current = gate.begin(scope());
			state.current.active = true;
			pending.current = null;
			setStatus("Listening. Say an option, open a screen, or stop voice controls.");
			try {
				recognizer.current.start({ lang: "en-US", interimResults: false, continuous: false, maxAlternatives: 1, contextualStrings: [...(activeCard()?.options ?? []), "open Bible", "go back", "repeat options", "stop voice controls"] });
			} catch { state.current.active = false; fail("Speech recognition could not start. Tap Start voice controls to retry."); }
		}, 250);
	}
	async function execute(text: string, expected: unknown, changed = false) {
		if (blocked() || expected !== scope()) return;
		state.current.command = true;
		setStatus("Working on your request.");
		const epoch = state.current.epoch;
		try {
			if (changed) await say("Those options changed. Here are the current choices.");
			if (epoch !== state.current.epoch) return;
			const card = activeCard();
			const command = resolveVoiceCommand(text, { options: card?.options ?? [] });
			if (command.type === "stop") { stop(); return; }
			if (command.type === "choose") {
				if (!card || card !== expected) throw new Error("Those options changed. Say repeat options to hear the current choices.");
				// Retire before calling the same tap action: duplicate finals cannot send twice.
				cardRef.current = null;
				await say(`Choosing ${command.label}.`);
				if (epoch !== state.current.epoch) return;
				await card.choose(command.label);
			} else if (command.type === "navigate" || command.type === "back") {
				await say(command.type === "navigate" ? `Opening ${command.destination}.` : "Going back.");
				if (epoch !== state.current.epoch) return;
				await afterTabDepartureGuard(() => {
					if (command.type === "navigate") router.navigate(paths[command.destination]);
					else if (router.canGoBack()) router.back();
				});
			} else if (command.type === "repeat") {
				await say(card ? `${card.question} ${card.options.map((label, index) => `Option ${index + 1}. ${label}.`).join(" ")}` : "Say open Today, Bible, Chat, Connections, Study, Notes or Settings. You can also say go back or stop voice controls.");
			} else if (command.type === "ambiguous") {
				await say("I heard more than one possible choice. Say the complete option label or its number. Say repeat options to hear them.");
			} else if (card?.allowOther) {
				cardRef.current = null;
				await say("I am sending your answer.");
				if (epoch !== state.current.epoch) return;
				await card.choose(text);
			} else if (card?.ask && /^(?:what|why|how|who|when|where|can|could|would|please explain|i want|my |i )/i.test(text.trim())) {
				await say("I am working on your answer.");
				if (epoch !== state.current.epoch) return;
				await card.ask(text);
			} else if (card) {
				await say("I could not match that choice. Say the complete option label or its number, or repeat options.");
			} else if (activeChat()) {
				await say("I am working on your answer.");
				if (epoch !== state.current.epoch) return;
				await activeChat()!.send(text);
			} else {
				await say("Say open Chat to ask SureWord a question, or say the name of a screen to open.");
			}
		} catch (error) {
			if (epoch === state.current.epoch) fail(error instanceof Error ? error.message : "That request failed. Voice controls stopped.");
		} finally {
			state.current.command = false;
			if (epoch === state.current.epoch) schedule();
		}
	}
	// Event listeners call the latest closures without replacing native subscriptions mid-turn.
	const latest = useRef({ schedule, execute, fail, blocked, scope, say });
	latest.current = { schedule, execute, fail, blocked, scope, say };
	const speak = useCallback((text: string) => state.current.enabled ? latest.current.say(text) : Promise.resolve(), []);

	async function start() {
		if (!eligible || state.current.requesting || state.current.enabled) return;
		state.current.requesting = true;
		state.current.permission = true;
		const epoch = ++state.current.epoch;
		const account = userId;
		try {
			setStatus("Checking voice access and microphone permission.");
			const access = await apiJson<unknown>(getToken, "/api/voice/live");
			if (epoch !== state.current.epoch || currentAccount.current !== account) return;
			if (!voiceControlsEligible(access)) throw new Error("Voice controls require SureWord Pro on the enabled account.");
			const { ExpoSpeechRecognitionModule: module } = await import("expo-speech-recognition");
			if (epoch !== state.current.epoch || currentAccount.current !== account) return;
			if (!module.isRecognitionAvailable()) throw new Error("Speech recognition is unavailable. Enable a speech recognition service in Android settings.");
			if (!recognizer.current) {
				recognizer.current = module;
				subscriptions.current = [
					module.addListener("result", (event) => {
						const token = turn.current;
						if (token && event.isFinal && !latest.current.blocked() && token.scope !== latest.current.scope()) {
							pending.current = { text: "repeat options", scope: latest.current.scope(), changed: true };
							gate.invalidate();
							return;
						}
						if (!token || !gate.consume(token, latest.current.scope(), event.isFinal, latest.current.blocked())) return;
						const text = event.results[0]?.transcript.trim();
						if (text) pending.current = { text, scope: token.scope };
					}),
					module.addListener("end", () => {
						state.current.active = false;
						for (const resolve of endWaiters.current.splice(0)) resolve();
						const result = pending.current;
						pending.current = null;
						if (result) void latest.current.execute(result.text, result.scope, result.changed);
						else latest.current.schedule();
					}),
					module.addListener("error", (event) => {
						if (event.error === "aborted" || !state.current.enabled) return;
						latest.current.fail(event.error === "no-speech" || event.error === "speech-timeout" ? "I did not hear a complete answer. Tap Start voice controls to try again." : "Speech recognition stopped. Check microphone permission and your connection, then tap Start voice controls.");
					}),
				];
			}
			state.current.prompting = true;
			const permission = await module.requestPermissionsAsync();
			state.current.prompting = false;
			if (epoch !== state.current.epoch || currentAccount.current !== account) return;
			if (!permission.granted) throw new Error("Microphone permission is off. Allow microphone and speech recognition in device settings, then tap Start voice controls.");
			state.current.enabled = true;
			setEnabled(true);
			await say("Voice controls on. Say an option label or number. Say open Bible, Today, Chat, Connections, Study, Notes or Settings. Say repeat options to hear the choices, or stop voice controls.");
		} catch (error) {
			if (epoch === state.current.epoch) fail(error instanceof Error && !/native module/i.test(error.message) ? error.message : "This build does not include speech recognition. Install a new SureWord native build to use voice controls.");
		} finally {
			state.current.permission = false;
			state.current.prompting = false;
			state.current.requesting = false;
			if (epoch === state.current.epoch) schedule();
		}
	}

	useEffect(() => {
		setEligibleAccount(null);
		stop();
		if (!isSignedIn || !userId) return;
		let current = true;
		void apiJson<unknown>(getToken, "/api/voice/live").then((response) => {
			if (current && voiceControlsEligible(response)) setEligibleAccount(userId);
		}).catch(() => undefined);
		return () => { current = false; stop(); };
	}, [userId, isSignedIn, getToken, stop]);
	useEffect(() => {
		const pause = registerMicrophonePause(abortMicrophone);
		const output = subscribeVoiceOutput(() => { if (!voiceOutputActive()) latest.current.schedule(); });
		const failure = subscribeVoiceFailure((message) => { if (state.current.enabled) latest.current.fail(message); });
		const appState = AppState.addEventListener("change", (next) => {
			state.current.foreground = next === "active";
			if (next === "background" || (next !== "active" && !state.current.prompting)) stop();
			else if (next === "active") latest.current.schedule();
		});
		return () => { stop(); pause(); output(); failure(); appState.remove(); for (const subscription of subscriptions.current) subscription.remove(); };
	}, [abortMicrophone, stop]);
	useEffect(() => { void abortMicrophone().then(() => latest.current.schedule()).catch((error) => latest.current.fail(String(error))); }, [path, abortMicrophone]);

	const registerCard = useCallback((card: VoiceCard) => {
		const entry = { path: state.current.path, card };
		cardRef.current = entry;
		return () => { if (cardRef.current === entry) { cardRef.current = null; gate.invalidate(); } };
	}, [gate]);
	const registerChat = useCallback((chat: VoiceChat) => {
		const entry = { path: state.current.path, chat };
		chatRef.current = entry;
		if (chat.busy) void abortMicrophone().catch((error) => latest.current.fail(String(error)));
		else latest.current.schedule();
		return () => { if (chatRef.current === entry) chatRef.current = null; };
	}, [abortMicrophone]);
	const finish = () => { if (state.current.active) { setStatus("Finishing your spoken answer."); recognizer.current?.stop(); } };
	return <Context.Provider value={{ eligible, enabled, status, start: () => { void start(); }, finish, stop, speak, registerCard, registerChat }}><View style={{ flex: 1 }}>
		{children}
		{eligible ? <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), gap: 6 }}>
			<AppText style={{ color: colors.text }}>{status}</AppText>
			<View style={{ flexDirection: "row", gap: 12 }}>
				<Pressable accessibilityRole="button" accessibilityLabel={enabled ? "Finish spoken answer" : "Start voice controls"} onPress={enabled ? finish : () => { void start(); }} style={{ minHeight: 48, justifyContent: "center", flex: 1 }}><AppText style={{ color: colors.accent }}>{enabled ? "Finish answer" : "Start voice controls"}</AppText></Pressable>
				{enabled ? <Pressable accessibilityRole="button" accessibilityLabel="Stop voice controls" onPress={stop} style={{ minHeight: 48, justifyContent: "center" }}><AppText style={{ color: colors.accent }}>Stop voice controls</AppText></Pressable> : null}
			</View>
		</View> : null}
	</View></Context.Provider>;
}
export function useVoiceControls() { return useContext(Context); }

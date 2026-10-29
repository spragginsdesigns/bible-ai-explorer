"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { confirmVoiceDeparture } from "@/lib/voice/web-departure";
import { resolveVoiceCommand } from "@/lib/voice/voice-commands";
import { VoiceActionRegistry, currentVoiceAction, voiceScopeSignature, type VoiceActionScope } from "@/lib/voice/web-actions";
import { browserRecognitionFactory, SpeechCommandSession } from "@/lib/voice/web-speech";
import { beginNarration, narrationBusy, speakVoiceStatus, subscribeNarration, waitForWelcomeNarration } from "@/lib/voice/web-narration";

const ROUTES = { today: "/today", bible: "/bible", chat: "/", connections: "/connections", study: "/study", notes: "/notes", settings: "/settings" } as const;
interface VoiceControls {
	speak: (text: string) => Promise<void>;
	register: (scope: VoiceActionScope) => () => void;
	setChat: (binding: { key: string; busy: boolean; send: (text: string) => Promise<void> }) => () => void;
	stop: () => void;
}
const Context = createContext<VoiceControls | null>(null);
const ActiveContext = createContext(false);
export function useVoiceControlsActive(): boolean { return useContext(ActiveContext); }
export function useVoiceControls(): VoiceControls | null { return useContext(Context); }

/** A scope's functions stay fresh without restarting recognition on every render. */
export function useVoiceActionScope(scope: VoiceActionScope | null): void {
	const controls = useVoiceControls();
	const latest = useRef(scope);
	latest.current = scope;
	const signature = voiceScopeSignature(scope);
	useEffect(() => {
		const value = latest.current;
		if (!controls || !value) return;
		return controls.register({ ...value,
			actions: value.actions.map((action, index) => ({ label: action.label, run: () => {
				const current = currentVoiceAction(latest.current, signature, index);
				if (!current) return controls.speak("The options changed. Say read options to hear the current choices.");
				return current.run();
			} })),
			...(value.onText ? { onText: (text: string) => {
				if (voiceScopeSignature(latest.current) !== signature) return controls.speak("The question changed. Say read options before answering.");
				return latest.current?.onText?.(text);
			} } : {}),
		});
	}, [controls, signature]);
}

export default function VoiceControlProvider({ children }: { children: React.ReactNode }) {
	const { userId, isLoaded } = useAuth();
	const pathname = usePathname();
	const router = useRouter();
	const [allowed, setAllowed] = useState(false);
	const [supported, setSupported] = useState(true);
	const [active, setActive] = useState(false);
	const [status, setStatus] = useState("Voice controls are off.");
	const [error, setError] = useState("");
	const engine = useRef<SpeechCommandSession | null>(null);
	const speech = useRef<ReturnType<typeof speakVoiceStatus> | null>(null);
	const activeRef = useRef(false);
	const speechGeneration = useRef(0);
	const verifiedOwner = useRef<string | null>(null);
	const owner = useRef(userId);
	owner.current = userId;
	const routeHistory = useRef<string[]>([]);
	const routeEpoch = useRef(0);
	const chatKey = useRef<string | null>(null);
	const chat = useRef<{ key: string; busy: boolean; send: (text: string) => Promise<void> } | null>(null);
	const registryChanged = useRef<() => void>(() => {});
	const pendingOptions = useRef(false);
	const optionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [registry] = useState(() => new VoiceActionRegistry(() => { engine.current?.invalidate(); registryChanged.current(); }));
	const sync = useCallback(() => engine.current?.setPaused(narrationBusy() || Boolean(chat.current?.busy)), []);
	const stop = useCallback(() => {
		activeRef.current = false;
		speechGeneration.current += 1;
		engine.current?.stop();
		speech.current?.cancel();
		speech.current = null;
		setActive(false);
		setStatus("Voice controls stopped. Microphone off.");
	}, []);
	const announce = useCallback(async (text: string) => {
		const generation = ++speechGeneration.current;
		// Hold capture while waiting too; never speak over welcome HTMLAudio.
		const release = beginNarration();
		try {
			speech.current?.cancel();
			await waitForWelcomeNarration();
			if (generation !== speechGeneration.current) return;
			setStatus(text.length > 240 ? "SureWord is speaking. Microphone paused." : text);
			const next = speakVoiceStatus(text);
			speech.current = next;
			await next.done;
			if (speech.current === next) speech.current = null;
		} catch {
			stop();
			setError("Speech playback failed. Voice controls stopped. Check your browser's sound settings, then start again.");
		} finally { release(); }
	}, [stop]);

	const readPendingOptions = useCallback(() => {
		if (!pendingOptions.current || !activeRef.current || narrationBusy() || chat.current?.busy || !registry.options.length) return;
		pendingOptions.current = false;
		void announce(registry.readOptions(false));
	}, [announce, registry]);
	registryChanged.current = () => {
		pendingOptions.current = true;
		if (optionsTimer.current) clearTimeout(optionsTimer.current);
		optionsTimer.current = setTimeout(() => { optionsTimer.current = null; readPendingOptions(); }, 150);
	};
	const dispatch = useRef<(text: string, revision: number) => Promise<void>>(async () => {});
	dispatch.current = async (text, revision) => {
		if (!activeRef.current || owner.current !== verifiedOwner.current || !allowed) return;
		if (revision !== registry.revision) { await announce(`The choices changed. ${registry.readOptions()}`); return; }
		const capturedRoute = routeEpoch.current;
		const command = resolveVoiceCommand(text, { options: registry.options });
		switch (command.type) {
			case "choose":
				if (!await registry.choose(command.index, revision)) await announce(`That choice is no longer available. ${registry.readOptions()}`);
				break;
			case "navigate": {
				await announce(`Opening ${command.destination}.`);
				if (!activeRef.current || capturedRoute !== routeEpoch.current) break;
				if (!await confirmVoiceDeparture()) { await announce("Your note could not be saved. I kept this screen open. Please try saving it again before leaving."); break; }
				if (activeRef.current && capturedRoute === routeEpoch.current) { registry.clear(); router.push(ROUTES[command.destination]); }
				break;
			}
			case "back": {
				if (routeHistory.current.length < 2) { await announce("There is no previous SureWord screen in this session. Say open followed by the screen's name."); break; }
				const previous = routeHistory.current.at(-2)!;
				await announce("Going back.");
				if (!activeRef.current || capturedRoute !== routeEpoch.current) break;
				if (!await confirmVoiceDeparture()) { await announce("Your note could not be saved. I kept this screen open. Please try saving it again before leaving."); break; }
				if (activeRef.current && capturedRoute === routeEpoch.current) { routeHistory.current.pop(); registry.clear(); router.push(previous); }
				break;
			}
			case "repeat": await announce(registry.readOptions()); break;
			case "stop": stop(); await announce("Voice controls stopped. Microphone off."); break;
			case "ambiguous": await announce(`Please say one option's name or number. ${registry.readOptions()}`); break;
			case "unmatched": {
				const scope = registry.current;
				if (scope?.onText) await scope.onText(text);
				else if (scope?.actions.length) await announce(`I could not match that choice. ${registry.readOptions()}`);
				else if (chat.current && !chat.current.busy) await chat.current.send(text);
				else await announce("Open Chat to ask a question, or say open followed by the screen's name.");
				break;
			}
		}
	};

	useEffect(() => {
		stop(); setAllowed(false); setError(""); verifiedOwner.current = null;
		if (!isLoaded || !userId) { registry.clear(); return; }
		const controller = new AbortController();
		void fetch("/api/voice/live", { cache: "no-store", signal: controller.signal }).then(async response => {
			const body = await response.json().catch(() => null);
			// GET 200 proves the server-side verified-owner gate. `available`
			// describes the paid relay; browser controls do not open that relay.
			if (!controller.signal.aborted && owner.current === userId) {
				const permitted = response.ok && body?.pro === true;
				verifiedOwner.current = permitted ? userId : null;
				setAllowed(permitted);
			}
		}).catch(() => { if (!controller.signal.aborted) setAllowed(false); });
		return () => { controller.abort(); stop(); };
	}, [isLoaded, userId, registry, stop]);

	useEffect(() => {
		const factory = browserRecognitionFactory();
		setSupported(Boolean(factory));
		if (!factory || !allowed) return;
		const session = new SpeechCommandSession({
			create: factory, revision: () => registry.revision,
			onFinal: (text, revision) => dispatch.current(text, revision),
			onStatus: value => {
				if (value === "listening") setStatus("Listening. Say an option, a question in Chat, or open followed by a screen name.");
				else if (value === "processing") setStatus("Working on what you said. Microphone paused.");
				else if (value === "paused" && activeRef.current) setStatus("Microphone paused while SureWord speaks or saves your answer.");
			},
			onError: message => { stop(); setError(message); void announce(message); },
		});
		engine.current = session;
		const unsubscribe = subscribeNarration(() => { readPendingOptions(); sync(); });
		return () => { unsubscribe(); session.stop(); if (engine.current === session) engine.current = null; };
	}, [allowed, announce, registry, stop, sync, readPendingOptions]);

	useEffect(() => {
		const route = window.location.pathname + window.location.search + window.location.hash;
		if (routeHistory.current.at(-1) !== route) routeHistory.current = [...routeHistory.current.slice(-49), route];
		// Navigation keeps the root session, but invalidates the old screen's
		// actions and any words captured before that route change.
		routeEpoch.current += 1; speechGeneration.current += 1;
		speech.current?.cancel(); speech.current = null;
		engine.current?.invalidate();
		if (pathname === "/voice") stop();
	}, [pathname, stop]);
	useEffect(() => {
		const hidden = () => { if (document.visibilityState !== "visible") stop(); };
		document.addEventListener("visibilitychange", hidden);
		window.addEventListener("pagehide", stop);
		return () => { if (optionsTimer.current) clearTimeout(optionsTimer.current); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stop); };
	}, [stop]);

	const controls = useMemo<VoiceControls>(() => ({
		speak: announce,
		register: scope => allowed ? registry.register(scope) : () => {}, stop,
		setChat: binding => {
			if (chatKey.current !== null && chatKey.current !== binding.key) { speechGeneration.current += 1; speech.current?.cancel(); speech.current = null; }
			chatKey.current = binding.key;
			chat.current = binding;
			engine.current?.invalidate();
			sync();
			readPendingOptions();
			return () => { if (chat.current === binding) { chat.current = null; sync(); } };
		},
	}), [allowed, announce, registry, stop, sync, readPendingOptions]);
	const start = async () => {
		if (!allowed || owner.current !== verifiedOwner.current || !supported || !engine.current) return;
		setError(""); activeRef.current = true; setActive(true); pendingOptions.current = false;
		await announce(`Voice controls ready. ${registry.readOptions(false)}`);
		if (!activeRef.current) return;
		sync(); engine.current.start();
	};
	return <Context.Provider value={controls}><ActiveContext.Provider value={active}>
		{children}
		{allowed && <section aria-label="Voice controls" className="fixed right-3 top-3 z-[80] max-h-[60dvh] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border bg-background p-3 text-foreground shadow-lg">
			<div className="flex flex-wrap gap-2">
				<button type="button" className="min-h-12 rounded-lg border px-3 font-semibold" disabled={active || !supported || pathname === "/voice"} onClick={() => void start()}>Start voice controls</button>
				<button type="button" className="min-h-12 rounded-lg border px-3 font-semibold" disabled={!active} onClick={stop}>Stop voice controls</button>
			</div>
			<p role="status" aria-live={active ? "off" : "polite"} aria-atomic="true" className="sr-only">{status}</p>
			{!supported && <p role="alert">This browser does not support speech recognition. Use a browser with Web Speech recognition, such as Chrome, or use the app&apos;s accessible controls.</p>}
			{error && <p role="alert">{error}</p>}
			<details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">Voice help and options</summary>
				<p>Say an option&apos;s name or number, “open Bible”, “go back”, “read options”, or “stop”. In Chat, ask your question. Your browser processes speech using its speech service. Use headphones and stop listening before using a screen reader.</p>
				<p className="mt-2" aria-hidden="true">{status}</p>
				<button type="button" className="mt-2 min-h-12 rounded-lg border px-4" onClick={() => void announce(registry.readOptions())}>Read available options</button>
			</details>
			{pathname === "/voice" && <p className="text-sm">Use Start voice conversation on this page. Voice controls are paused so two microphones cannot run together.</p>}
		</section>}
	</ActiveContext.Provider></Context.Provider>;
}

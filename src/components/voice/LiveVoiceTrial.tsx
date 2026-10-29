"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveAudio, pcmToBase64 } from "@/lib/voice/live-audio";

interface Availability {
	available: boolean;
	pro: boolean;
	limits: { sessionSeconds: number; dailySeconds: number; monthlySeconds: number };
	remainingSeconds?: number;
	message?: string;
}
interface Transcript { role: "user" | "assistant"; text: string; segmentId: string; startMs: number; endMs: number }
interface TrialError { code: string; message: string }
type Phase = "idle" | "starting" | "active" | "ending" | "ended";
const MAX_UPLOAD_BUFFER = 256 * 1024;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function responseBody(response: Response): Promise<Record<string, unknown>> {
	const body: unknown = await response.json().catch(() => null);
	if (!record(body)) throw new Error("The voice service returned an unreadable response.");
	return body;
}

export function LiveVoiceTrial({ conversationId, onConversationSaved }: {
	conversationId?: string;
	onConversationSaved?: (conversationId: string) => void;
}) {
	const [availability, setAvailability] = useState<Availability | null>(null);
	const [checking, setChecking] = useState(true);
	const [phase, setPhase] = useState<Phase>("idle");
	const [message, setMessage] = useState("Check availability, then start when you are ready.");
	const [error, setError] = useState<TrialError | null>(null);
	const [muted, setMuted] = useState(false);
	const [blocked, setBlocked] = useState(false);
	const [remaining, setRemaining] = useState<number | null>(null);
	const [transcripts, setTranscripts] = useState<Transcript[]>([]);
	const [saved, setSaved] = useState(false);
	const [sessionConversationId, setSessionConversationId] = useState<string | null>(null);
	const [refresh, setRefresh] = useState(0);
	const socket = useRef<WebSocket | null>(null);
	const audio = useRef<LiveAudio | null>(null);
	const request = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const active = useRef(false);
	const expiryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const setupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedCallback = useRef(onConversationSaved);
	savedCallback.current = onConversationSaved;

	const cleanup = useCallback((notifyRelay: boolean) => {
		generation.current += 1;
		active.current = false;
		request.current?.abort();
		request.current = null;
		if (setupTimer.current) clearTimeout(setupTimer.current);
		if (expiryTimer.current) clearInterval(expiryTimer.current);
		setupTimer.current = null;
		expiryTimer.current = null;
		audio.current?.close();
		audio.current = null;
		const current = socket.current;
		socket.current = null;
		if (current) {
			current.onmessage = null;
			current.onopen = null;
			current.onerror = null;
			current.onclose = null;
			try { if (notifyRelay && current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: "end" })); } catch { /* A broken connection still needs local cleanup. */ }
			try { current.close(); } catch { /* Transport already gone. */ }
		}
	}, []);

	const finish = useCallback((reason: string, failure?: TrialError) => {
		cleanup(true);
		setPhase("ended");
		setMessage(reason);
		setBlocked(false);
		setMuted(false);
		if (failure) setError(failure);
		setRefresh(value => value + 1);
	}, [cleanup]);

	const endConversation = useCallback(() => {
		const current = socket.current;
		if (!current || current.readyState !== WebSocket.OPEN) {
			finish("Conversation ended. Check chat for saved turns.");
			return;
		}
		// Release capture immediately while retaining the final save/usage response.
		audio.current?.close(); audio.current = null;
		if (setupTimer.current) clearTimeout(setupTimer.current);
		if (expiryTimer.current) clearInterval(expiryTimer.current);
		expiryTimer.current = null;
		setPhase("ending"); setBlocked(false); setRemaining(null);
		setMessage("Microphone off. Finishing the conversation and checking saved turns.");
		try { current.send(JSON.stringify({ type: "end" })); }
		catch { finish("Conversation ended. Check chat for saved turns."); return; }
		setupTimer.current = setTimeout(() => finish("Conversation ended. Final save confirmation was not received. Check chat before repeating an action.", {
			code: "end_unconfirmed", message: "The connection ended before the server confirmed its final save.",
		}), 5000);
	}, [finish]);

	useEffect(() => {
		const controller = new AbortController();
		setChecking(true);
		void fetch("/api/voice/live", { signal: controller.signal, cache: "no-store" }).then(async response => {
			const body = await responseBody(response);
			if (controller.signal.aborted) return;
			if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Could not check voice availability.");
			if (typeof body.available !== "boolean" || typeof body.pro !== "boolean" || !record(body.limits)
				|| ![body.limits.sessionSeconds, body.limits.dailySeconds, body.limits.monthlySeconds].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
				throw new Error("Voice limits are unavailable. Try checking again.");
			}
			setAvailability(body as unknown as Availability);
		}).catch(cause => {
			if (!controller.signal.aborted) { setAvailability(null); setError({ code: "availability", message: cause instanceof Error ? cause.message : "Could not check voice availability." }); }
		}).finally(() => { if (!controller.signal.aborted) setChecking(false); });
		return () => controller.abort();
	}, [refresh]);

	useEffect(() => {
		const hide = () => { if (document.hidden && active.current) finish("Conversation ended because this page left the foreground. Start again when you are ready."); };
		const offline = () => { if (active.current) finish("Connection lost. Your saved turns remain in chat.", { code: "offline", message: "Reconnect to the internet, then start again." }); };
		const pageHide = () => { if (active.current) finish("Conversation ended because this page was left. Start again when you are ready."); };
		document.addEventListener("visibilitychange", hide);
		window.addEventListener("offline", offline);
		window.addEventListener("pagehide", pageHide);
		return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("offline", offline); window.removeEventListener("pagehide", pageHide); cleanup(true); };
	}, [cleanup, finish]);

	// A caller switching threads must not carry a live microphone into that thread.
	useEffect(() => {
		if (active.current) finish("Conversation ended because the selected chat changed. Start again in this chat when you are ready.");
	}, [conversationId, finish]);

	const start = async () => {
		if (active.current || checking || !availability?.available || !availability.pro || availability.remainingSeconds === 0) return;
		cleanup(true);
		const run = generation.current;
		active.current = true;
		setPhase("starting"); setError(null); setTranscripts([]); setSaved(false); setSessionConversationId(null); setRemaining(null); setMuted(false); setBlocked(false);
		setMessage("Connecting. Your browser will ask for microphone access.");
		const fail = (code: string, text: string) => { if (generation.current === run) finish("Conversation ended.", { code, message: text }); };
		try {
			if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
				throw new Error("This browser needs a secure page, microphone access, and AudioWorklet support. Try a current browser.");
			}
			const engine = new LiveAudio(value => { if (generation.current === run) setBlocked(value); });
			audio.current = engine;
			// Preserve the Start click's user activation before requesting a ticket.
			void engine.resume().catch(() => { if (generation.current === run && audio.current === engine) setBlocked(true); });
			if (generation.current !== run) return;
			const controller = new AbortController(); request.current = controller;
			setupTimer.current = setTimeout(() => fail("setup_timeout", "Voice setup timed out. Start again to retry."), 30_000);
			const response = await fetch("/api/voice/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(conversationId ? { conversationId } : {}), signal: controller.signal });
			const body = await responseBody(response);
			if (generation.current !== run) return;
			if (!response.ok) {
				fail(typeof body.code === "string" ? body.code : `http_${response.status}`, typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "This account cannot start voice right now."); return;
			}
			if (typeof body.ticket !== "string" || typeof body.relayUrl !== "string") throw new Error("The voice service did not return a session ticket.");
			const url = new URL(body.relayUrl, window.location.href);
			if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("The voice service needs a secure connection.");
			const ws = new WebSocket(url); socket.current = ws;
			let ready = false;
			ws.onopen = () => { if (generation.current === run) ws.send(JSON.stringify({ type: "start", ticket: body.ticket })); };
			ws.onerror = () => fail("connection", "Could not connect to voice. Check your connection and start again.");
			ws.onclose = () => { if (generation.current === run) finish("Voice disconnected. Saved turns remain in chat.", { code: "disconnected", message: "Start again to reconnect. The interrupted turn may not have finished." }); };
			ws.onmessage = event => {
				if (generation.current !== run) return;
				try {
					if (typeof event.data !== "string" || event.data.length > 1_000_000) throw new Error("The voice service returned an invalid message.");
					const item: unknown = JSON.parse(event.data);
					if (!record(item)) throw new Error("The voice service returned an invalid message.");
					switch (item.type) {
						case "ready": {
							if (ready) break;
							ready = true;
							// End may be pressed while the provider is still starting.
							if (!audio.current) break;
							if (typeof item.conversationId === "string" && item.conversationId) setSessionConversationId(item.conversationId);
							const expires = typeof item.expiresAt === "string" ? Date.parse(item.expiresAt) : Number.NaN;
							if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("The voice session has expired. Start again.");
							const tick = () => { const left = Math.max(0, Math.ceil((expires - Date.now()) / 1000)); setRemaining(left); if (!left) finish("Session time reached. Your saved turns remain in chat."); };
							tick(); expiryTimer.current = setInterval(tick, 1000);
							void engine.startCapture(bytes => {
								if (generation.current !== run || ws.readyState !== WebSocket.OPEN) return;
								if (ws.bufferedAmount > MAX_UPLOAD_BUFFER) { fail("backpressure", "Your connection could not keep up with microphone audio. Start again on a stronger connection."); return; }
								ws.send(JSON.stringify({ type: "audio", audio: pcmToBase64(bytes) }));
							}, () => fail("microphone_ended", "Microphone access stopped. Check your microphone permission and start again.")).then(() => {
								if (generation.current !== run || audio.current !== engine) return;
								if (setupTimer.current) clearTimeout(setupTimer.current); setupTimer.current = null;
								setPhase("active"); setMessage("Microphone on. You can speak now. Use mute before navigating with your screen reader.");
							}).catch(cause => { if (audio.current === engine) fail("microphone", cause instanceof Error ? cause.message : "Could not open the microphone. Check browser permissions."); });
							break;
							}
						case "audio": if (typeof item.audio === "string") engine.play(item.audio); break;
						case "transcript":
							if ((item.role === "user" || item.role === "assistant") && typeof item.text === "string" && typeof item.segmentId === "string" && typeof item.startMs === "number" && typeof item.endMs === "number") {
								const segment = item as unknown as Transcript;
								setTranscripts(current => {
									const index = current.findIndex(value => value.role === segment.role && value.segmentId === segment.segmentId);
									if (index < 0) return [...current, segment].slice(-200);
									return current.map((value, i) => i === index ? segment : value);
								});
							}
							break;
						case "status": if (typeof item.message === "string") setMessage(item.message); break;
						case "turn.saved": if (typeof item.conversationId === "string") { setSaved(true); savedCallback.current?.(item.conversationId); } break;
						case "ended": finish(typeof item.message === "string" ? item.message : "Conversation ended. Saved turns remain in chat."); break;
						case "error": fail(typeof item.code === "string" ? item.code : "relay", typeof item.message === "string" ? item.message : "The voice service could not continue."); break;
					}
				} catch (cause) { fail("audio_protocol", cause instanceof Error ? cause.message : "Could not play the voice response."); }
			};
		} catch (cause) { fail("setup", cause instanceof Error ? cause.message : "Could not start voice."); }
	};

	const toggleMute = () => {
		const next = !muted;
		audio.current?.setMuted(next); setMuted(next);
		if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "mute", muted: next }));
		setMessage(next ? "Microphone muted. You can navigate without sending audio." : "Microphone on. You can speak now.");
	};
	const interrupt = () => {
		audio.current?.flush();
		if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: "interrupt" }));
		setMessage("Stopped speaking. Completed actions stay saved.");
	};
	const running = phase === "active" || phase === "starting" || phase === "ending";
	const permitted = availability?.available && availability.pro && availability.remainingSeconds !== 0;
	return <Card>
		<CardHeader><CardTitle>Talk to SureWord</CardTitle><CardDescription>Pro voice trial. You will hear an AI voice. Your words and answers are saved with chat. Microphone audio is sent only after you press Start.</CardDescription></CardHeader>
		<CardContent className="space-y-5">
			<p className="text-sm text-muted-foreground">Keep this page in the foreground. Leaving it ends the session and releases your microphone. Use headphones when possible. With a screen reader, mute the microphone before navigating controls.</p>
			{checking ? <p>Checking voice access…</p> : availability ? <p className="text-sm">{!availability.pro ? "Voice trials require SureWord Pro." : !availability.available ? (availability.message ?? "Voice trials are unavailable right now.") : availability.remainingSeconds === 0 ? "Your voice allowance has been used. Try again after it refreshes." : `Up to ${clock(availability.limits.sessionSeconds)} per session. Daily allowance: ${clock(availability.limits.dailySeconds)}. Monthly allowance: ${clock(availability.limits.monthlySeconds)}.${typeof availability.remainingSeconds === "number" ? ` Available now: ${clock(Math.max(0, Math.floor(availability.remainingSeconds)))}.` : ""}`}</p> : null}
			<p role="status" aria-live="polite" aria-atomic="true">{message}</p>
			{remaining !== null && <p className="font-mono text-sm" aria-live="off">Session time remaining: {clock(remaining)}</p>}
			{error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-700 dark:text-red-300">{error.message} <span className="text-xs">({error.code})</span></p>}
			<div className="flex flex-wrap gap-3">
				<Button type="button" size="lg" disabled={running || checking || !permitted} onClick={() => void start()}>Start voice conversation</Button>
				<Button type="button" variant="outline" size="lg" disabled={phase !== "active"} aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute microphone" : "Mute microphone"}</Button>
				<Button type="button" variant="outline" size="lg" disabled={!running || phase === "ending"} onClick={interrupt}>Stop speaking</Button>
				<Button type="button" variant="outline" size="lg" disabled={!running || phase === "ending"} onClick={endConversation}>End conversation</Button>
				{!running && <Button type="button" variant="ghost" size="lg" disabled={checking} onClick={() => { setError(null); setRefresh(value => value + 1); }}>Check access again</Button>}
			</div>
			{blocked && running && <div className="space-y-2"><p role="alert">Your browser paused voice playback. Enable sound to hear the reply.</p><Button type="button" size="lg" onClick={() => void audio.current?.resume().catch(() => setError({ code: "playback_blocked", message: "Sound is still blocked. Check this browser's audio permissions or end the session." }))}>Enable voice playback</Button></div>}
			<section aria-label="Voice transcript" className="space-y-3 border-t pt-4">
				<h2 className="font-semibold">Conversation transcript</h2>
				<p className="text-sm text-muted-foreground">{saved ? "At least one turn is saved in chat." : "Live words may change. A turn is saved only after the server confirms it."} The latest 200 speech segments appear here.</p>
				{sessionConversationId && <a
					href={`/?conversationId=${encodeURIComponent(sessionConversationId)}`}
					onClick={() => { if (active.current) finish("Voice ended. Opening your saved chat."); }}
					className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
				>{saved ? "Open saved chat" : "Open this chat"}{running ? " (ends voice conversation)" : ""}</a>}
				<div role="log" aria-live="off" className="max-h-96 space-y-4 overflow-y-auto">
					{transcripts.length ? transcripts.map(segment => <p key={`${segment.role}:${segment.segmentId}`} className="whitespace-pre-wrap break-words"><strong>{segment.role === "user" ? "You" : "SureWord"}: </strong>{segment.text}</p>) : <p className="text-sm text-muted-foreground">Your conversation will appear here after you start.</p>}
				</div>
			</section>
		</CardContent>
	</Card>;
}

export default LiveVoiceTrial;

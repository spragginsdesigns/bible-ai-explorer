"use client";

import {
	EMPTY_VOICE_USAGE,
	READ_SCRIPTURE_TOOL,
	VOICE_IDLE_END_MS,
	VOICE_MAX_SESSION_MS,
	addResponseUsage,
	addTranscriptionUsage,
	isLikelyNarrationEcho,
	isWorthKeeping,
	narrationClip,
	verseAtTime,
	type VoiceTurn,
	type VoiceUsage,
} from "@/lib/beta/voice/voice-rules";

/**
 * Voice Study's conversation engine (docs/beta/voice.md), one per page. It
 * owns everything that is not React: the microphone, the WebRTC call to the
 * Realtime API (opened through /api/beta/voice/call, so no key is in the
 * browser), the data channel's events, relaying tool calls to
 * /api/beta/voice/tool, and the narrated KJV player. The component renders
 * the snapshots it emits.
 *
 * Barge-in has two paths. While SureWord speaks, the API's semantic VAD
 * cancels the reply the moment the listener talks (WebRTC truncates what was
 * not heard). While the narrated KJV plays, the API is told not to answer on
 * its own; the recording pauses at the first sound of speech, and once the
 * words are transcribed it either resumes (it was the recording leaking back
 * into the microphone) or stops and lets SureWord answer what was said.
 */

export type VoicePhase = "idle" | "starting" | "listening" | "hearing" | "thinking" | "speaking" | "reading" | "ended";
export type MicProblem = "denied" | "missing" | "busy" | "unsupported" | "insecure";
export type EndReason = "user" | "idle" | "limit" | "dropped" | "left";

export interface ReadingState {
	callId: string;
	reference: string;
	book: number;
	chapter: number;
	verses: { verse: number; text: string }[];
	status: "loading" | "playing" | "paused" | "done" | "stopped" | "unavailable";
	current: number | null;
}

export interface LiveTurn {
	key: string;
	role: "user" | "assistant" | "reading";
	text: string;
	/** Still being heard, spoken or transcribed. */
	live: boolean;
	interrupted?: boolean;
	reading?: ReadingState;
}

export interface VoiceSnapshot {
	phase: VoicePhase;
	problem: MicProblem | null;
	error: string | null;
	endReason: EndReason | null;
	turns: LiveTurn[];
	muted: boolean;
	/** What a tool call is doing, for the status line ("Looking in Scripture"). */
	activity: string | null;
	startedAt: number | null;
	sessionId: string | null;
	saveState: "idle" | "saving" | "saved" | "failed";
	note: { id: string; title: string } | null;
	noteState: "idle" | "saving" | "saved" | "failed";
	usage: VoiceUsage;
}

interface ReadingPlan {
	status: "ready";
	reference: string;
	book: number;
	bookName: string;
	chapter: number;
	first: number;
	last: number;
	wholeChapter: boolean;
	verses: { verse: number; text: string }[];
}

interface ChapterAudio {
	status: "ready";
	audioUrl: string;
	verses: { verse: number; start: number; end: number }[];
}

interface FunctionCall {
	itemId: string;
	callId: string;
	name: string;
	arguments: string;
}

type ServerEvent = { type: string; [key: string]: unknown };

const ACTIVITY: Record<string, string> = {
	searchScripture: "Searching Scripture",
	findVerses: "Finding the verse",
	getPassage: "Opening the passage",
	getCrossReferences: "Following the cross-references",
	recallStudy: "Looking through your past study",
};

/** A twentieth of a second of silence, played once inside the start tap so iOS lets the narration play later. */
function silentWavUrl(): string {
	const samples = 1200;
	const bytes = new DataView(new ArrayBuffer(44 + samples * 2));
	const text = (offset: number, value: string) => [...value].forEach((char, i) => bytes.setUint8(offset + i, char.charCodeAt(0)));
	text(0, "RIFF");
	bytes.setUint32(4, 36 + samples * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	bytes.setUint32(16, 16, true);
	bytes.setUint16(20, 1, true);
	bytes.setUint16(22, 1, true);
	bytes.setUint32(24, 24_000, true);
	bytes.setUint32(28, 48_000, true);
	bytes.setUint16(32, 2, true);
	bytes.setUint16(34, 16, true);
	text(36, "data");
	bytes.setUint32(40, samples * 2, true);
	return URL.createObjectURL(new Blob([bytes.buffer], { type: "audio/wav" }));
}

function micProblemFor(error: unknown): MicProblem | null {
	const name = error instanceof DOMException ? error.name : "";
	if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
	if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
	if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
	return null;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		return typeof body.error === "string" ? body.error : fallback;
	} catch {
		return fallback;
	}
}

export class VoiceStudyEngine {
	private snapshot: VoiceSnapshot = {
		phase: "idle",
		problem: null,
		error: null,
		endReason: null,
		turns: [],
		muted: false,
		activity: null,
		startedAt: null,
		sessionId: null,
		saveState: "idle",
		note: null,
		noteState: "idle",
		usage: EMPTY_VOICE_USAGE,
	};
	private pc: RTCPeerConnection | null = null;
	private dc: RTCDataChannel | null = null;
	private mic: MediaStream | null = null;
	private remote: HTMLAudioElement | null = null;
	private narration: HTMLAudioElement | null = null;
	private audioContext: AudioContext | null = null;
	private levelFrame = 0;
	private timers: ReturnType<typeof setInterval>[] = [];
	private lastActivity = 0;
	private userSpeaking = false;
	private responding = false;
	private assistantAudio = false;
	private quietWaiters: (() => void)[] = [];
	/** The assistant items each response produced, so a cleared playback can mark them interrupted. */
	private responseItems = new Map<string, Set<string>>();
	/**
	 * Responses already handled. Over WebRTC a reply that finished generating
	 * but was talked over arrives a second time as `cancelled`; its usage and
	 * tool calls must not count twice.
	 */
	private handledResponses = new Set<string>();
	/** Bumped each time the listener starts speaking, so stale tool results do not answer over them. */
	private speechCount = 0;
	/** Bumped on every response.created, so a tool result is not answered twice. */
	private responsesCreated = 0;
	/**
	 * Bumped by each start(), so work still in flight from an earlier
	 * conversation (a microphone grant, a connect, a save) cannot reach this one.
	 */
	private generation = 0;
	/** Saves and note writes run one at a time, each seeing the id the last one kept. */
	private keeping: Promise<unknown> = Promise.resolve();
	/** The study-store id kept for a conversation (by generation), so a queued save updates it, never duplicates it. */
	private kept: { generation: number; id: string | null } = { generation: 0, id: null };
	private reading: {
		call: FunctionCall;
		plan: ReadingPlan;
		pausedFor: string | null;
		resumeTimer: ReturnType<typeof setTimeout> | null;
		settle: (outcome: { status: "played" | "stopped" | "failed"; listenerSaid?: string }) => void;
	} | null = null;
	private ending = false;
	private silentUrl: string | null = null;

	constructor(
		private readonly emit: (snapshot: VoiceSnapshot) => void,
		private readonly onLevel: (level: number) => void,
	) {}

	get state(): VoiceSnapshot {
		return this.snapshot;
	}

	private set(patch: Partial<VoiceSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...patch };
		this.emit(this.snapshot);
	}

	private updateTurns(update: (turns: LiveTurn[]) => LiveTurn[]): void {
		this.set({ turns: update(this.snapshot.turns) });
	}

	private upsertTurn(key: string, role: LiveTurn["role"], patch: (turn: LiveTurn) => Partial<LiveTurn>): void {
		this.updateTurns((turns) => {
			const index = turns.findIndex((turn) => turn.key === key);
			if (index === -1) {
				const fresh: LiveTurn = { key, role, text: "", live: true };
				return [...turns, { ...fresh, ...patch(fresh) }];
			}
			const next = turns.slice();
			next[index] = { ...turns[index], ...patch(turns[index]) };
			return next;
		});
	}

	private removeTurn(key: string): void {
		this.updateTurns((turns) => turns.filter((turn) => turn.key !== key));
	}

	private setReading(callId: string, patch: Partial<ReadingState>): void {
		this.updateTurns((turns) =>
			turns.map((turn) => (turn.key === callId && turn.reading ? { ...turn, reading: { ...turn.reading, ...patch } } : turn)),
		);
	}

	/** The phase as it is now, read through a call so a check after an await is not narrowed away. */
	private phaseNow(): VoicePhase {
		return this.snapshot.phase;
	}

	private get active(): boolean {
		return this.snapshot.phase !== "idle" && this.snapshot.phase !== "ended";
	}

	/** Recomputes the status line from what is actually happening. */
	private settlePhase(): void {
		if (!this.active || this.snapshot.phase === "starting") return;
		const reading = this.reading?.plan && this.snapshot.turns.find((turn) => turn.key === this.reading?.call.callId)?.reading;
		let phase: VoicePhase = "listening";
		if (this.userSpeaking) phase = "hearing";
		else if (reading && (reading.status === "playing" || reading.status === "loading")) phase = "reading";
		else if (this.assistantAudio) phase = "speaking";
		else if (this.responding || this.snapshot.activity) phase = "thinking";
		if (phase !== this.snapshot.phase) this.set({ phase });
	}

	// ------------------------------------------------------------ start / end

	/** Must be called from a tap: the microphone prompt and audio unlock need the gesture. */
	async start(): Promise<void> {
		if (this.active) return;
		if (typeof window === "undefined") return;
		if (!window.isSecureContext) return this.set({ problem: "insecure", phase: "idle" });
		if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
			return this.set({ problem: "unsupported", phase: "idle" });
		}
		this.ending = false;
		const generation = ++this.generation;
		const current = () => generation === this.generation && this.phaseNow() === "starting";
		// Everything that needs the tap's user activation happens before the first await.
		this.remote = new Audio();
		this.remote.autoplay = true;
		this.narration = new Audio();
		this.narration.preload = "auto";
		this.silentUrl ??= silentWavUrl();
		this.narration.src = this.silentUrl;
		void this.narration.play().catch(() => undefined);
		try {
			const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			this.audioContext = Context ? new Context() : null;
			void this.audioContext?.resume().catch(() => undefined);
		} catch {
			this.audioContext = null;
		}
		this.set({
			phase: "starting",
			problem: null,
			error: null,
			endReason: null,
			turns: [],
			activity: null,
			startedAt: null,
			sessionId: null,
			saveState: "idle",
			note: null,
			noteState: "idle",
			usage: EMPTY_VOICE_USAGE,
			muted: false,
		});

		let mic: MediaStream;
		try {
			mic = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
		} catch (error) {
			if (!current()) return;
			this.teardown();
			const problem = micProblemFor(error);
			return this.set(problem ? { phase: "idle", problem } : { phase: "idle", error: "The microphone could not be started." });
		}
		// Ended (or the page left, or started over) while the browser was asking: let the microphone go.
		if (!current()) {
			for (const track of mic.getTracks()) track.stop();
			return;
		}
		this.mic = mic;

		try {
			const pc = new RTCPeerConnection();
			this.pc = pc;
			pc.ontrack = (event) => {
				if (!this.remote) return;
				this.remote.srcObject = event.streams[0] ?? new MediaStream([event.track]);
				void this.remote.play().catch(() => undefined);
			};
			pc.onconnectionstatechange = () => {
				if (pc.connectionState === "failed" && this.active) void this.end("dropped");
			};
			for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
			const dc = pc.createDataChannel("oai-events");
			this.dc = dc;
			dc.onmessage = (message) => {
				try {
					this.handle(JSON.parse(String(message.data)) as ServerEvent);
				} catch (error) {
					console.error("Voice Study: unreadable event", error);
				}
			};
			dc.onopen = () => {
				this.lastActivity = Date.now();
				this.set({ phase: "listening", startedAt: Date.now() });
				this.startTimers();
			};
			dc.onclose = () => {
				if (this.active && !this.ending) void this.end("dropped");
			};

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			const response = await fetch("/api/beta/voice/call", {
				method: "POST",
				headers: { "Content-Type": "application/sdp" },
				body: offer.sdp ?? "",
			});
			if (!response.ok) throw new Error(await errorMessage(response, "The voice connection could not be opened."));
			const answer = await response.text();
			// Ended or started over while connecting: end() already let this call go; never connect it.
			if (!current()) {
				pc.close();
				return;
			}
			await pc.setRemoteDescription({ type: "answer", sdp: answer });
			this.startLevelMeter();
		} catch (error) {
			// end() already tore the call down if the conversation was ended while connecting.
			if (generation !== this.generation || this.phaseNow() === "ended") return;
			this.teardown();
			this.set({ phase: "idle", error: error instanceof Error ? error.message : "The voice connection could not be opened." });
		}
	}

	private startTimers(): void {
		const started = Date.now();
		this.timers.push(
			setInterval(() => {
				if (!this.active) return;
				if (Date.now() - started >= VOICE_MAX_SESSION_MS) {
					void this.end("limit");
					return;
				}
				const busy = this.userSpeaking || this.assistantAudio || this.responding || this.reading !== null || this.snapshot.activity !== null;
				if (busy) this.lastActivity = Date.now();
				else if (Date.now() - this.lastActivity >= VOICE_IDLE_END_MS) void this.end("idle");
			}, 5_000),
		);
	}

	private startLevelMeter(): void {
		if (!this.audioContext || !this.mic) return;
		try {
			const analyser = this.audioContext.createAnalyser();
			analyser.fftSize = 512;
			this.audioContext.createMediaStreamSource(this.mic).connect(analyser);
			const samples = new Uint8Array(analyser.fftSize);
			const tick = () => {
				if (!this.active) return;
				analyser.getByteTimeDomainData(samples);
				let sum = 0;
				for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
				this.onLevel(this.snapshot.muted ? 0 : Math.min(1, Math.sqrt(sum / samples.length) * 4));
				this.levelFrame = requestAnimationFrame(tick);
			};
			this.levelFrame = requestAnimationFrame(tick);
		} catch {
			// A level ring is decoration; the conversation works without it.
		}
	}

	setMuted(muted: boolean): void {
		for (const track of this.mic?.getAudioTracks() ?? []) track.enabled = !muted;
		this.set({ muted });
	}

	/** Ends the conversation and keeps it (when anything was said). */
	async end(reason: EndReason = "user"): Promise<void> {
		if (!this.active && this.snapshot.phase !== "starting") return;
		this.ending = true;
		const reading = this.reading;
		this.reading = null;
		if (reading?.resumeTimer) clearTimeout(reading.resumeTimer);
		// Let a pending reading's promise finish; it sees the conversation is over and stops.
		reading?.settle({ status: "stopped" });
		this.updateTurns((turns) => turns.map((turn) => ({ ...turn, live: false })));
		this.teardown();
		this.set({ phase: "ended", endReason: reason, activity: null });
		if (reading) this.setReading(reading.call.callId, { status: "stopped" });
		await this.save({ keepalive: reason === "left" });
	}

	private teardown(): void {
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		cancelAnimationFrame(this.levelFrame);
		this.onLevel(0);
		for (const track of this.mic?.getTracks() ?? []) track.stop();
		this.mic = null;
		try {
			this.dc?.close();
		} catch {
			// already closed
		}
		this.dc = null;
		this.pc?.close();
		this.pc = null;
		if (this.remote) this.remote.srcObject = null;
		if (this.narration) {
			// Let the recording go, so one still loading can never start once the conversation is over.
			this.narration.pause();
			this.narration.removeAttribute("src");
			this.narration.load();
		}
		void this.audioContext?.close().catch(() => undefined);
		this.audioContext = null;
		this.userSpeaking = false;
		this.responding = false;
		this.assistantAudio = false;
		this.flushQuietWaiters();
	}

	// ------------------------------------------------------------ events

	private send(event: Record<string, unknown>): void {
		if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
	}

	private handle(event: ServerEvent): void {
		switch (event.type) {
			case "input_audio_buffer.speech_started": {
				this.userSpeaking = true;
				this.speechCount += 1;
				this.lastActivity = Date.now();
				const itemId = String(event.item_id ?? `speech-${this.speechCount}`);
				if (this.reading && this.narration && !this.narration.paused) {
					this.narration.pause();
					this.reading.pausedFor = itemId;
					this.setReading(this.reading.call.callId, { status: "paused" });
				}
				this.upsertTurn(itemId, "user", () => ({ live: true }));
				break;
			}
			case "input_audio_buffer.speech_stopped": {
				this.userSpeaking = false;
				const reading = this.reading;
				if (reading?.pausedFor) {
					// The transcript decides; if it never comes, carry on reading.
					reading.resumeTimer = setTimeout(() => this.resumeReading(), 6_000);
				}
				break;
			}
			case "conversation.item.input_audio_transcription.delta": {
				const delta = typeof event.delta === "string" ? event.delta : "";
				this.upsertTurn(String(event.item_id), "user", (turn) => ({ text: turn.text + delta }));
				break;
			}
			case "conversation.item.input_audio_transcription.completed": {
				const itemId = String(event.item_id);
				const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
				this.set({ usage: addTranscriptionUsage(this.snapshot.usage, event.usage) });
				if (this.reading?.pausedFor === itemId) {
					this.decideReading(itemId, transcript);
					break;
				}
				if (transcript) this.upsertTurn(itemId, "user", () => ({ text: transcript, live: false }));
				else this.removeTurn(itemId);
				break;
			}
			case "conversation.item.input_audio_transcription.failed": {
				const itemId = String(event.item_id);
				if (this.reading?.pausedFor === itemId) this.resumeReading();
				this.upsertTurn(itemId, "user", (turn) => ({ live: false, text: turn.text || "(not caught)" }));
				break;
			}
			case "response.created":
				this.responding = true;
				this.responsesCreated += 1;
				break;
			case "response.output_item.added": {
				const item = event.item as { id?: string; type?: string; role?: string; name?: string } | undefined;
				if (item?.type === "message" && item.role === "assistant" && item.id) {
					this.upsertTurn(item.id, "assistant", () => ({ live: true }));
					const responseId = String(event.response_id ?? "");
					if (!this.responseItems.has(responseId)) this.responseItems.set(responseId, new Set());
					this.responseItems.get(responseId)?.add(item.id);
				}
				if (item?.type === "function_call" && item.name && item.name !== READ_SCRIPTURE_TOOL) this.set({ activity: ACTIVITY[item.name] ?? "Looking in Scripture" });
				break;
			}
			case "response.output_audio_transcript.delta": {
				const delta = typeof event.delta === "string" ? event.delta : "";
				this.upsertTurn(String(event.item_id), "assistant", (turn) => ({ text: turn.text + delta }));
				break;
			}
			case "response.output_audio_transcript.done": {
				const transcript = typeof event.transcript === "string" ? event.transcript : null;
				this.upsertTurn(String(event.item_id), "assistant", (turn) => ({ text: transcript ?? turn.text, live: false }));
				break;
			}
			case "output_audio_buffer.started":
				this.assistantAudio = true;
				this.lastActivity = Date.now();
				break;
			case "output_audio_buffer.stopped":
				this.assistantAudio = false;
				this.lastActivity = Date.now();
				this.flushQuietWaiters();
				break;
			case "output_audio_buffer.cleared": {
				// The listener talked over the answer. Over WebRTC the reply has often
				// finished generating by then, so this, not a cancelled response, is
				// what says part of it was never heard.
				this.assistantAudio = false;
				const items = this.responseItems.get(String(event.response_id ?? ""));
				if (items) {
					this.updateTurns((turns) => turns.map((turn) => (items.has(turn.key) && turn.text.trim() ? { ...turn, live: false, interrupted: true } : turn)));
				}
				this.flushQuietWaiters();
				break;
			}
			case "response.done":
				this.onResponseDone(event.response as Record<string, unknown> | undefined);
				break;
			case "error": {
				const error = event.error as { message?: string; code?: string } | undefined;
				console.error("Voice Study: realtime error", error?.code, error?.message);
				break;
			}
		}
		this.settlePhase();
	}

	private onResponseDone(response: Record<string, unknown> | undefined): void {
		this.responding = false;
		if (!response) return;
		const responseId = String(response.id ?? "");
		const repeat = responseId !== "" && this.handledResponses.has(responseId);
		this.handledResponses.add(responseId);
		if (!repeat) this.set({ usage: addResponseUsage(this.snapshot.usage, response.usage) });
		const output = Array.isArray(response.output) ? (response.output as Record<string, unknown>[]) : [];
		if (response.status === "cancelled") {
			const ids = new Set(output.map((item) => item.id));
			this.updateTurns((turns) =>
				turns.map((turn) => (turn.role === "assistant" && ids.has(turn.key) ? { ...turn, live: false, interrupted: true } : turn)),
			);
		}
		// Messages that produced no words (an empty preamble) leave no empty line behind.
		this.updateTurns((turns) => turns.filter((turn) => turn.role !== "assistant" || turn.live || turn.text.trim()));
		const calls: FunctionCall[] = output
			.filter((item) => item.type === "function_call" && item.status !== "incomplete")
			.map((item) => ({
				itemId: String(item.id),
				callId: String(item.call_id),
				name: String(item.name),
				arguments: typeof item.arguments === "string" ? item.arguments : "{}",
			}));
		if (calls.length > 0 && !repeat) void this.runCalls(calls);
		// A reply cancelled mid tool call leaves no call to run; drop its "Searching" status.
		else if (calls.length === 0 && this.snapshot.activity !== null) this.set({ activity: null });
	}

	// ------------------------------------------------------------ tools

	private async runCalls(calls: FunctionCall[]): Promise<void> {
		const before = this.speechCount;
		const responsesBefore = this.responsesCreated;
		const reads = calls.filter((call) => call.name === READ_SCRIPTURE_TOOL);
		let answered = false;
		for (const call of calls.filter((entry) => entry.name !== READ_SCRIPTURE_TOOL)) {
			this.lastActivity = Date.now();
			const output = await this.runTool(call);
			this.send({ type: "conversation.item.create", previous_item_id: call.itemId, item: { type: "function_call_output", call_id: call.callId, output } });
			answered = true;
		}
		this.set({ activity: null });
		for (const call of reads) await this.read(call, before);
		// A search result gets its answer unless the listener has moved on: they are
		// talking now, or what they said got its own reply (which sees the result too).
		// A cough that got no reply does not leave the answer unsaid.
		if (answered && reads.length === 0 && this.active && !this.userSpeaking && this.responsesCreated === responsesBefore) {
			this.send({ type: "response.create" });
		}
		this.settlePhase();
	}

	private async runTool(call: FunctionCall): Promise<string> {
		try {
			const response = await fetch("/api/beta/voice/tool", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: call.name, arguments: call.arguments }),
			});
			if (!response.ok) return JSON.stringify({ error: await errorMessage(response, "The lookup failed.") });
			const body = (await response.json()) as { output?: unknown };
			return typeof body.output === "string" ? body.output : JSON.stringify({ error: "The lookup returned nothing." });
		} catch {
			return JSON.stringify({ error: "The lookup could not be reached." });
		}
	}

	private untilAssistantQuiet(): Promise<void> {
		if (!this.assistantAudio) return Promise.resolve();
		return new Promise((resolve) => {
			this.quietWaiters.push(resolve);
			setTimeout(resolve, 15_000);
		});
	}

	private flushQuietWaiters(): void {
		const waiters = this.quietWaiters;
		this.quietWaiters = [];
		for (const resolve of waiters) resolve();
	}

	private setTurnDetection(autoRespond: boolean): void {
		this.send({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: autoRespond, interrupt_response: autoRespond } } },
			},
		});
	}

	private finishCall(call: FunctionCall, output: Record<string, unknown>, respond: boolean): void {
		this.send({
			type: "conversation.item.create",
			previous_item_id: call.itemId,
			item: { type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) },
		});
		if (respond && this.active) this.send({ type: "response.create" });
	}

	/** readScripture: play the passage from the narrated KJV, never a synthesized voice. */
	private async read(call: FunctionCall, speechBefore: number): Promise<void> {
		let reference = "";
		try {
			reference = String((JSON.parse(call.arguments) as { reference?: unknown }).reference ?? "");
		} catch {
			reference = "";
		}
		const planResponse = await fetch("/api/beta/voice/tool", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: READ_SCRIPTURE_TOOL, arguments: { reference } }),
		}).catch(() => null);
		const plan = planResponse?.ok ? ((await planResponse.json()) as { reading?: ReadingPlan | { status: "not_found" } }).reading : null;
		if (!plan || plan.status !== "ready") {
			this.finishCall(call, { status: "not_found", reference, note: "No such passage. Ask which passage they meant." }, true);
			return;
		}
		this.upsertTurn(call.callId, "reading", () => ({
			text: plan.reference,
			live: true,
			reading: { callId: call.callId, reference: plan.reference, book: plan.book, chapter: plan.chapter, verses: plan.verses, status: "loading", current: null },
		}));
		this.settlePhase();

		const audioResponse = await fetch(`/api/bible/audio?book=${plan.book}&chapter=${plan.chapter}`).catch(() => null);
		const audio = audioResponse?.ok ? ((await audioResponse.json()) as ChapterAudio | { status: "unavailable" }) : null;
		const clip = audio?.status === "ready" ? narrationClip(audio.verses, plan.first, plan.last, plan.wholeChapter) : null;
		if (!audio || audio.status !== "ready" || !clip || !this.narration || !this.active) {
			this.setReading(call.callId, { status: "unavailable" });
			this.upsertTurn(call.callId, "reading", () => ({ live: false }));
			this.finishCall(call, { status: "unavailable", reference: plan.reference, note: "There is no narrated recording for this passage. Its words are on the listener's screen; do not read them yourself." }, true);
			return;
		}
		const timings = audio.verses;

		await this.untilAssistantQuiet();
		if (!this.active || !this.narration) return;
		if (this.speechCount !== speechBefore) {
			// They started talking before the reading began; answer them instead.
			this.setReading(call.callId, { status: "stopped" });
			this.upsertTurn(call.callId, "reading", () => ({ live: false, interrupted: true }));
			this.finishCall(call, { status: "skipped", reference: plan.reference, note: "The listener spoke before the reading began. Answer what they said." }, false);
			return;
		}
		this.setTurnDetection(false);

		const outcome = await new Promise<{ status: "played" | "stopped" | "failed"; listenerSaid?: string }>((settle) => {
			const narration = this.narration!;
			this.reading = { call, plan, pausedFor: null, resumeTimer: null, settle };
			let stopAt: ReturnType<typeof setTimeout> | null = null;
			const done = (result: { status: "played" | "stopped" | "failed"; listenerSaid?: string }) => {
				narration.ontimeupdate = null;
				narration.onended = null;
				narration.onerror = null;
				narration.removeEventListener("loadedmetadata", begin);
				if (stopAt) clearTimeout(stopAt);
				settle(result);
			};
			this.reading.settle = done;
			narration.ontimeupdate = () => {
				this.lastActivity = Date.now();
				const current = verseAtTime(timings, narration.currentTime);
				const shown = current !== null && current >= plan.first && current <= plan.last ? current : null;
				const state = this.snapshot.turns.find((turn) => turn.key === call.callId)?.reading;
				if (state && state.current !== shown) this.setReading(call.callId, { current: shown });
				const left = clip.end - narration.currentTime;
				if (left <= 0) done({ status: "played" });
				// timeupdate comes every 15-250 ms; stop on the clip's last word, not a moment into the next verse.
				else if (left < 0.3 && !stopAt && !narration.paused) {
					stopAt = setTimeout(() => {
						if (narration.paused) return void (stopAt = null);
						narration.pause();
						done({ status: "played" });
					}, (left / (narration.playbackRate || 1)) * 1000);
				}
			};
			narration.onended = () => done({ status: "played" });
			narration.onerror = () => done({ status: "failed" });
			narration.src = audio.audioUrl;
			narration.currentTime = clip.start;
			const begin = () => {
				// Only for the reading still under way: never after End, a stop, or a newer reading.
				if (this.reading?.call !== call || !this.active) return;
				narration.currentTime = clip.start;
				this.setReading(call.callId, { status: "playing" });
				this.settlePhase();
				narration.play().catch(() => done({ status: "failed" }));
			};
			if (narration.readyState >= 1) begin();
			else narration.addEventListener("loadedmetadata", begin, { once: true });
		});

		const reading = this.reading;
		this.reading = null;
		if (reading?.resumeTimer) clearTimeout(reading.resumeTimer);
		this.narration?.pause();
		if (!this.active) return;
		const heardThrough = this.snapshot.turns.find((turn) => turn.key === call.callId)?.reading?.current ?? null;
		this.setReading(call.callId, { status: outcome.status === "played" ? "done" : outcome.status === "failed" ? "unavailable" : "stopped" });
		this.upsertTurn(call.callId, "reading", () => ({ live: false, interrupted: outcome.status === "stopped" }));
		this.setTurnDetection(true);
		const output: Record<string, unknown> = { status: outcome.status, reference: plan.reference };
		if (outcome.status === "stopped") {
			output.stopped_at = heardThrough ? `${plan.bookName} ${plan.chapter}:${heardThrough}` : plan.reference;
			output.note = "The listener stopped the reading to say something. Answer what they said.";
		}
		if (outcome.status === "failed") output.note = "The recording could not play. The words are on the listener's screen; do not read them yourself.";
		this.finishCall(call, output, true);
		this.settlePhase();
	}

	/** The words heard while the recording was paused: the recording leaking back, or the listener? */
	private decideReading(itemId: string, transcript: string): void {
		const reading = this.reading;
		if (!reading) return;
		if (reading.resumeTimer) clearTimeout(reading.resumeTimer);
		reading.resumeTimer = null;
		const state = this.snapshot.turns.find((turn) => turn.key === reading.call.callId)?.reading;
		const near = (state?.current ?? reading.plan.first) - reading.plan.first;
		const playing = reading.plan.verses.slice(Math.max(0, near - 2), near + 3).map((row) => row.text).join(" ");
		if (isLikelyNarrationEcho(transcript, playing)) {
			// The microphone heard the recording. Forget it and carry on reading.
			this.send({ type: "conversation.item.delete", item_id: itemId });
			this.removeTurn(itemId);
			this.resumeReading();
			return;
		}
		this.upsertTurn(itemId, "user", () => ({ text: transcript, live: false }));
		reading.settle({ status: "stopped", listenerSaid: transcript });
	}

	private resumeReading(): void {
		const reading = this.reading;
		if (!reading || !this.narration) return;
		if (reading.resumeTimer) clearTimeout(reading.resumeTimer);
		reading.resumeTimer = null;
		const itemId = reading.pausedFor;
		reading.pausedFor = null;
		if (itemId) {
			const turn = this.snapshot.turns.find((entry) => entry.key === itemId);
			if (turn && !turn.text.trim()) this.removeTurn(itemId);
		}
		this.setReading(reading.call.callId, { status: "playing" });
		void this.narration.play().catch(() => reading.settle({ status: "failed" }));
		this.settlePhase();
	}

	// ------------------------------------------------------------ keeping it

	turnsForSaving(): VoiceTurn[] {
		// Only the settled part: a note continues from the count it saved, so an
		// answer still being spoken (or a question still being transcribed) waits
		// for the next save instead of being cut short in the note for good.
		const firstLive = this.snapshot.turns.findIndex((turn) => turn.live);
		const settled = firstLive === -1 ? this.snapshot.turns : this.snapshot.turns.slice(0, firstLive);
		return settled
			.filter((turn) => turn.text.trim())
			// A reading that never played (no recording, or talked over before it began) was not read aloud.
			.filter((turn) => !turn.reading || (turn.reading.status !== "unavailable" && !(turn.reading.status === "stopped" && turn.reading.current === null)))
			.map((turn) => ({ role: turn.role, text: turn.role === "reading" ? (turn.reading?.reference ?? turn.text) : turn.text, ...(turn.interrupted && { interrupted: true }) }));
	}

	/** Runs a save or note write after the ones before it, so each sees the id the last one kept. */
	private keep<T>(task: () => Promise<T>): Promise<T> {
		const run = this.keeping.then(task);
		this.keeping = run.catch(() => undefined);
		return run;
	}

	/** Keeps the conversation in the study store; returns its id. */
	save(options: { keepalive?: boolean } = {}): Promise<string | null> {
		const save = this.saveTask(options);
		// A page being left cannot wait its turn; its save goes now.
		return options.keepalive ? save() : this.keep(save);
	}

	/**
	 * A save of the conversation as it is now (its turns and its generation are
	 * taken here, not when the save gets its turn), run later by keep().
	 */
	private saveTask(options: { keepalive?: boolean }): () => Promise<string | null> {
		const generation = this.generation;
		const turns = this.turnsForSaving();
		const startedAt = new Date(this.snapshot.startedAt ?? Date.now()).toISOString();
		const endedAt = new Date().toISOString();
		const usage = this.snapshot.usage;
		return () => this.saveNow(generation, { turns, startedAt, endedAt, usage }, options);
	}

	private async saveNow(
		generation: number,
		conversation: { turns: VoiceTurn[]; startedAt: string; endedAt: string; usage: VoiceSnapshot["usage"] },
		options: { keepalive?: boolean },
	): Promise<string | null> {
		const keptId = this.kept.generation === generation ? this.kept.id : null;
		if (!isWorthKeeping(conversation.turns)) return keptId;
		if (generation === this.generation) this.set({ saveState: "saving" });
		const payload = JSON.stringify({ id: keptId ?? undefined, ...conversation });
		try {
			const response = await fetch("/api/beta/voice/sessions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: payload,
				// A page being left still delivers its last save (bounded by the browser's 64 KB).
				keepalive: Boolean(options.keepalive) && payload.length < 60_000,
			});
			if (!response.ok) throw new Error(await errorMessage(response, "Could not keep this conversation."));
			const body = (await response.json()) as { session?: { id: string } };
			const id = body.session?.id ?? null;
			if (id) this.kept = { generation, id };
			// A newer conversation started meanwhile: this id belongs to the old one.
			if (generation === this.generation) this.set({ sessionId: id, saveState: "saved" });
			return id;
		} catch {
			if (generation === this.generation) this.set({ saveState: "failed" });
			return null;
		}
	}

	/** Saves the conversation as a Note (keeping the session first). */
	async saveNote(): Promise<void> {
		if (this.snapshot.noteState === "saving") return;
		this.set({ noteState: "saving" });
		const generation = this.generation;
		const save = this.saveTask({});
		// The session save and the note write go as one step, so an End save cannot land between them.
		const note = await this.keep(async () => {
			const id = await save();
			if (!id) return null;
			try {
				const response = await fetch(`/api/beta/voice/sessions/${encodeURIComponent(id)}/note`, { method: "POST" });
				if (!response.ok) return null;
				const body = (await response.json()) as { note?: { noteId: string; noteTitle: string } };
				return body.note ?? null;
			} catch {
				return null;
			}
		});
		if (generation !== this.generation) return;
		this.set(note ? { noteState: "saved", note: { id: note.noteId, title: note.noteTitle } } : { noteState: "failed" });
	}

	dispose(): void {
		if (this.active || this.snapshot.phase === "starting") void this.end("left");
		if (this.silentUrl) URL.revokeObjectURL(this.silentUrl);
		this.silentUrl = null;
	}
}

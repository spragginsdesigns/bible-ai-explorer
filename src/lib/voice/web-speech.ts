/** Browser speech input. One final utterance at a time, with generation fencing. */
export interface RecognitionLike {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
	onend: (() => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	start(): void;
	abort(): void;
}
export type RecognitionFactory = () => RecognitionLike;
export function browserRecognitionFactory(): RecognitionFactory | null {
	const browser = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
	const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
	return Recognition ? () => new Recognition() : null;
}

export class SpeechCommandSession {
	private active = false;
	private paused = false;
	private processing = false;
	private generation = 0;
	private recognition: RecognitionLike | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(private readonly config: {
		create: RecognitionFactory;
		revision: () => number;
		onFinal: (text: string, revision: number) => Promise<void>;
		onStatus: (status: "listening" | "paused" | "processing" | "stopped") => void;
		onError: (message: string) => void;
	}) {}
	start(): void { this.active = true; this.sync(); }
	stop(): void { this.active = false; this.cancelRound(); this.config.onStatus("stopped"); }
	setPaused(paused: boolean): void {
		this.paused = paused;
		if (paused) { this.cancelRound(); if (this.active) this.config.onStatus("paused"); }
		else this.sync();
	}
	/** Invalidate words captured against a card/route that has since changed. */
	invalidate(): void { this.cancelRound(); this.sync(); }
	private cancelRound(): void {
		this.generation += 1;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const recognition = this.recognition;
		this.recognition = null;
		if (recognition) {
			recognition.onresult = recognition.onend = recognition.onerror = null;
			try { recognition.abort(); } catch { /* Already ended. */ }
		}
	}
	private sync(): void {
		if (!this.active || this.paused || this.processing || this.recognition || this.timer) return;
		let recognition: RecognitionLike;
		try { recognition = this.config.create(); }
		catch { this.stop(); this.config.onError("This browser could not create speech recognition. Use the accessible controls or try another supported browser."); return; }
		const generation = ++this.generation;
		const revision = this.config.revision();
		this.recognition = recognition;
		recognition.lang = "en-US";
		recognition.continuous = false;
		recognition.interimResults = false;
		recognition.onresult = event => {
			if (!this.active || this.paused || this.generation !== generation || revision !== this.config.revision()) return;
			for (let i = event.resultIndex; i < event.results.length; i += 1) {
				if (!event.results[i].isFinal) continue;
				const text = event.results[i][0].transcript.trim();
				if (!text) continue;
				this.processing = true;
				this.cancelRound();
				this.config.onStatus("processing");
				void this.config.onFinal(text, revision).catch(() => {
					this.stop(); this.config.onError("Voice could not finish that action. Check the result before trying again.");
				}).finally(() => {
					this.processing = false;
					// Allow React's busy/route effects to land before another capture.
					if (this.active) this.timer = setTimeout(() => { this.timer = null; this.sync(); }, 200);
				});
				break;
			}
		};
		recognition.onend = () => {
			if (generation !== this.generation) return;
			this.recognition = null;
			if (this.active && !this.paused) this.timer = setTimeout(() => { this.timer = null; this.sync(); }, 250);
		};
		recognition.onerror = event => {
			if (generation !== this.generation || event.error === "aborted" || event.error === "no-speech") return;
			this.stop();
			this.config.onError(event.error === "not-allowed" || event.error === "service-not-allowed"
				? "Microphone access was denied. Allow microphone access in your browser, then press Start voice controls."
				: event.error === "audio-capture" ? "No microphone is available. Connect a microphone, then start again."
				: "Speech recognition stopped. Check your connection and browser permissions, then start again.");
		};
		try { recognition.start(); this.config.onStatus("listening"); }
		catch { this.stop(); this.config.onError("The browser could not start speech recognition. Press Start voice controls to try again."); }
	}
}

import { acquireVoiceOutput, reportVoiceFailure } from "./voiceActivity";

export interface VoiceAudioPlayer {
	muted: boolean;
	readonly playing: boolean;
	readonly currentStatus: { playing: boolean; playbackState: string; currentTime: number; duration: number; error?: unknown };
	play: () => void;
	pause: () => void;
	seekTo: (seconds: number) => Promise<void>;
	addListener: (event: "playbackStatusUpdate", listener: (status: { playing: boolean; currentTime: number; didJustFinish: boolean; error?: unknown }) => void) => { remove: () => void };
}

/**
 * Native lock-screen Play bypasses JS. Keep paused players muted so their
 * first remote samples cannot reach a listening microphone, then rewind the
 * silent lead-in and resume only after microphone shutdown is acknowledged.
 */
export class VoiceAudioPlayback {
	private lease: ReturnType<typeof acquireVoiceOutput> | null = null;
	private operation = 0;
	private disposed = false;
	private pending = false;
	private authorized = false;
	private wasPlaying = false;
	private pausedAt = 0;
	private readonly subscription: { remove: () => void };

	constructor(private readonly player: VoiceAudioPlayer, private readonly onError: (error: unknown) => void) {
		player.muted = true;
		this.subscription = player.addListener("playbackStatusUpdate", (status) => {
			if (this.disposed) return;
			// Status callbacks can sit in JS's queue across Pause or a new Play.
			// Expo's native getter reads current ExoPlayer state on its main thread.
			let live: VoiceAudioPlayer["currentStatus"];
			let playing: boolean;
			try { live = this.player.currentStatus; playing = this.player.playing; }
			catch { this.dispose(); return; }
			if (status.playing && !playing && !live.playing) return;
			if (!status.playing && (playing || live.playing)) return;
			if (status.didJustFinish && live.playbackState !== "ended" && !(live.duration > 0 && live.currentTime >= live.duration - 0.1)) return;
			if (status.error && !live.error && live.playbackState !== "idle" && live.playbackState !== "failed") return;
			if (status.error || status.didJustFinish) {
				if (this.lease || this.pending || this.authorized || this.wasPlaying) {
					this.pause();
					if (status.error) this.onError(status.error);
				}
				return;
			}
			if (status.playing) {
				if (this.authorized && this.lease) { this.pausedAt = status.currentTime; this.wasPlaying = true; return; }
				if (!this.pending) {
					// A remote native resume starts muted. Pause it before awaiting
					// capture shutdown, preserving the last audible position.
					try { this.player.pause(); } catch (error) { this.pause(); this.onError(error); return; }
					void this.play(this.pausedAt);
				}
			} else if (!this.pending) {
				this.pausedAt = status.currentTime;
				if (this.wasPlaying) this.pause();
			}
		});
	}

	async play(rewindTo?: number): Promise<boolean> {
		if (this.disposed) return false;
		const operation = ++this.operation;
		this.pending = true;
		const lease = this.lease ?? (this.lease = acquireVoiceOutput());
		const current = () => !this.disposed && operation === this.operation && this.lease === lease;
		try {
			await lease.microphoneStopped;
			if (!current()) return false;
			if (rewindTo !== undefined) {
				await this.player.seekTo(rewindTo);
				if (!current()) return false;
			}
			this.authorized = true;
			this.player.muted = false;
			this.player.play();
			this.pending = false;
			return true;
		} catch (error) {
			if (current()) {
				this.pause();
				reportVoiceFailure("Audio could not start safely. Voice controls stopped.");
				this.onError(error);
			}
			return false;
		}
	}

	pause() {
		this.operation += 1;
		this.pending = false;
		this.authorized = false;
		this.wasPlaying = false;
		const lease = this.lease; this.lease = null;
		try { this.player.muted = true; this.player.pause(); }
		catch { /* The native object can already be released during unmount. */ }
		finally { lease?.release(); }
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		try { this.subscription.remove(); }
		catch { /* A released native object has already removed its listeners. */ }
		finally { this.pause(); }
	}
}

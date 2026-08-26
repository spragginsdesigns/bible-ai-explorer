import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	Easing,
	PanResponder,
	Pressable,
	StyleSheet,
	Text,
	View,
	type GestureResponderEvent,
	type LayoutChangeEvent,
} from "react-native";
import {
	setAudioModeAsync,
	useAudioPlayer,
	useAudioPlayerStatus,
	type AudioLockScreenOptions,
	type AudioMetadata,
	type AudioSource,
} from "expo-audio";
import { GlassCard } from "@/components/ui";
import { TimelineStop } from "@/features/cross/TimelineStop";
import {
	fetchTodayCrossAudio,
	requestTodayCrossAudio,
	type DailyCrossAudio,
} from "@/features/notifications/api";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { API_URL } from "@/lib/api";
import { radius, spacing, type Colors } from "@/theme";
import {
	setListenRate,
	useSettings,
	useTheme,
	useThemedStyles,
} from "@/features/settings/settingsStore";
import {
	LISTEN_POLL_INTERVAL_MS,
	LISTEN_POLL_TIMEOUT_MS,
	formatClock,
	formatListenRate,
	listenPhase,
	listenProgress,
	nextListenRate,
	shouldPollListen,
	shouldRefreshListenUrl,
} from "@/features/cross/listen";

/**
 * expo-audio reports no error status of its own, so a URL the player cannot
 * fetch simply never loads. Play pressed with nothing playing this long after
 * is the signal that playback failed.
 */
const PLAYBACK_STALL_MS = 8_000;

/**
 * The square SureWord mark, served unauthenticated from the same host the
 * narration streams from. The notification's artwork is fetched by the native
 * media service with a bare `java.net.URL`, which carries no bearer token and
 * cannot read a bundled RN asset by resource name - so a public https URL is
 * the only shape that works, and a failed fetch simply leaves the card
 * artworkless rather than breaking playback.
 */
const ARTWORK_URL = `${API_URL}/web-app-manifest-512x512.png`;

/**
 * Skip buttons on the notification and lock screen. The jump is a fixed 10s in
 * expo-audio's media service (`SEEK_INTERVAL_MS`), not a number we get to pick.
 */
const LOCK_SCREEN_CONTROLS: AudioLockScreenOptions = {
	showSeekBackward: true,
	showSeekForward: true,
};

/**
 * Keep playing with the screen off, and put the devotional on the lock screen.
 *
 * Without `shouldPlayInBackground` the native module pauses every player the
 * moment the activity backgrounds - which is exactly what a screen timeout
 * does, and was why a listen died with the screen. `doNotMix` is required
 * alongside it: lock-screen controls are bound to audio focus, and a player
 * that never takes focus never gets them.
 */
function enableBackgroundListening() {
	return setAudioModeAsync({
		playsInSilentMode: true,
		interruptionMode: "doNotMix",
		shouldPlayInBackground: true,
		shouldRouteThroughEarpiece: false,
		allowsRecording: false,
	});
}

/** A slow gold pulse while the devotional is being written and narrated. */
function PreparingShimmer() {
	const styles = useThemedStyles(createStyles);
	const pulse = useRef(new Animated.Value(0.35)).current;

	useEffect(() => {
		const loop = Animated.loop(
			Animated.sequence([
				Animated.timing(pulse, {
					toValue: 1,
					duration: 1100,
					easing: Easing.inOut(Easing.ease),
					useNativeDriver: true,
				}),
				Animated.timing(pulse, { toValue: 0.35, duration: 1100, useNativeDriver: true }),
			])
		);
		loop.start();
		return () => loop.stop();
	}, [pulse]);

	return (
		<View style={styles.preparing}>
			<Animated.View style={[styles.shimmerBar, { opacity: pulse }]} />
			<Text style={styles.preparingText}>Preparing your devotional…</Text>
			<Text style={styles.preparingHint}>This usually takes about a minute.</Text>
		</View>
	);
}

/**
 * "Listen" - today's "Pick Up Your Cross" as a spoken devotional.
 *
 * The narration is made WITH the day, server-side, so this card never asks for
 * one: it shimmers until the scheduled generation lands, then becomes a player
 * with a scrubber, a speed chip and a "Read along" transcript. Listen is a
 * SureWord Pro benefit, so a free account gets the locked panel instead, and a
 * server with no ElevenLabs key renders nothing at all, timeline stop included.
 * Playback survives the screen going off and drives a real Android media
 * notification (play/pause, skip, scrubber, artwork, Bluetooth and headset
 * keys) - see `enableBackgroundListening` and the lock-screen effects below.
 *
 * `reference` is today's verse, shown as the notification's subtitle so a
 * locked phone says which day's word is playing. Mirrors
 * src/components/cross/ListenCard.tsx on web.
 */
export function ListenCard({ reference }: { reference?: string | null }) {
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { listenRate } = useSettings();

	const [audio, setAudio] = useState<DailyCrossAudio | null>(null);
	const [urlFetchedAt, setUrlFetchedAt] = useState<number | null>(null);
	const [playRequestedAt, setPlayRequestedAt] = useState<number | null>(null);
	const [failureText, setFailureText] = useState<string | null>(null);
	const [transcriptOpen, setTranscriptOpen] = useState(false);
	const [trackWidth, setTrackWidth] = useState(0);
	const [scrubFraction, setScrubFraction] = useState<number | null>(null);

	// Where to pick a listen back up after a URL refresh, and whether one has
	// already been spent on the current URL.
	const resumeAtRef = useRef(0);
	const resumePlayingRef = useRef(false);
	const refreshedRef = useRef(false);
	// Whether the current source has already spent its one token refresh.
	const tokenRetriedRef = useRef(false);

	// Read through a ref, never a dependency: the status object ticks several
	// times a second, and a stall timer that re-arms on every tick never fires.
	const currentTimeRef = useRef(0);

	const phase = failureText ? "failed" : listenPhase(audio);

	const streamUrl = audio?.streamUrl ?? null;
	const [source, setSource] = useState<AudioSource | null>(null);
	// Bumped to re-mint the bearer token and rebuild the player around it.
	const [tokenAttempt, setTokenAttempt] = useState(0);

	/**
	 * Play through our own API rather than the signed blob URL - the same proxy
	 * web uses, and for the same reason (see the stream route). That means the
	 * player has to carry the Clerk bearer token, which `AudioSource.headers`
	 * supports. The token is minted fresh here because it is short-lived and is
	 * only checked when the player opens its connection.
	 */
	useEffect(() => {
		if (!streamUrl) {
			setSource(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			const token = await getToken({ fresh: true }).catch(() => null);
			if (cancelled) return;
			setSource({
				uri: `${API_URL}${streamUrl}`,
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [streamUrl, tokenAttempt, getToken]);

	const player = useAudioPlayer(source, { updateInterval: 250 });
	const status = useAudioPlayerStatus(player);

	// The audio session is a process-wide setting, so it is claimed here rather
	// than at app start: this card is the only thing in SureWord that plays
	// audio, and nothing else should be taking exclusive focus on launch.
	useEffect(() => {
		void enableBackgroundListening().catch(() => {
			// A refused audio session costs the notification, not the listen -
			// playback still works, it just stops when the screen does.
		});
	}, []);

	/** What the notification and lock screen say about what is playing. */
	const metadata = useMemo<AudioMetadata>(
		() => ({
			title: audio?.title ?? "Today's devotional",
			artist: reference ? `Pick Up Your Cross · ${reference}` : "Pick Up Your Cross",
			albumTitle: "SureWord",
			artworkUrl: ARTWORK_URL,
		}),
		[audio?.title, reference]
	);

	// Read through a ref by the registration effect below, which must not re-run
	// (and rebuild the media session) every time a title lands.
	const metadataRef = useRef(metadata);
	metadataRef.current = metadata;

	// Hand this player to the OS once it has a loadable source. Registering is
	// what starts the media foreground service, so it is also what lets playback
	// outlive the screen.
	//
	// The cleanup is for the *swap* case - a refreshed token builds a new player,
	// and the outgoing one has to give the session up before the new one takes
	// it. On unmount the native side already unregisters as the player is
	// released (`sharedObjectDidRelease`), and that release runs before this
	// cleanup does, so the call is both redundant and made against an object
	// that is already gone. It is guarded rather than dropped: a leaked
	// notification for a player that no longer exists is the worse failure.
	useEffect(() => {
		if (!status.isLoaded) return;
		player.setActiveForLockScreen(true, metadataRef.current, LOCK_SCREEN_CONTROLS);
		return () => {
			try {
				player.clearLockScreenControls();
			} catch {
				// Already released with the component; the notification went with it.
			}
		};
	}, [player, status.isLoaded]);

	// The title arrives with the server payload, which can land after the player
	// does. This is the cheap update - re-registering would tear the session down
	// and build it again.
	useEffect(() => {
		if (!status.isLoaded) return;
		player.updateLockScreenMetadata(metadata);
	}, [player, status.isLoaded, metadata]);

	// A rebuilt player (a new token, a new day) starts at 1x, so the stored
	// speed is applied as an effect keyed on the player itself rather than set
	// once. Pitch correction keeps a devotional at 1.5x sounding like a person
	// reading quickly, not a chipmunk.
	useEffect(() => {
		if (!status.isLoaded) return;
		player.shouldCorrectPitch = true;
		player.setPlaybackRate(listenRate, "high");
	}, [player, status.isLoaded, listenRate]);

	const cycleRate = useCallback(() => {
		setListenRate(nextListenRate(listenRate));
	}, [listenRate]);

	// The player's real duration once the file is loaded; the server's word-count
	// estimate before that, so the total never reads 0:00 while buffering.
	const duration =
		status.isLoaded && status.duration > 0 ? status.duration : (audio?.durationSec ?? 0);
	const elapsed = scrubFraction !== null ? scrubFraction * duration : status.currentTime;
	const progress = listenProgress(elapsed, duration);

	currentTimeRef.current = status.currentTime;

	// Leaving the screen must not leave a voice playing behind it.
	useEffect(() => {
		return () => {
			player.pause();
		};
	}, [player]);

	// A finished devotional rewinds, so the play button starts it again rather
	// than doing nothing at the very end of the track.
	useEffect(() => {
		if (status.didJustFinish) void player.seekTo(0);
	}, [status.didJustFinish, player]);

	/** Record a server payload, stamping when this client received its URL. */
	const applyAudio = useCallback((next: DailyCrossAudio) => {
		setAudio(next);
		setUrlFetchedAt(next.url ? Date.now() : null);
	}, []);

	const loadState = useCallback(async () => {
		try {
			applyAudio(await fetchTodayCrossAudio(getToken));
		} catch {
			// A failed poll is not a failed generation: the next tick retries, and
			// the poll timeout is what eventually surfaces a problem.
		}
	}, [getToken, applyAudio]);

	useEffect(() => {
		void loadState();
	}, [loadState]);

	// Poll while a devotional is being prepared, and give up rather than
	// shimmer forever if the server never reports back.
	useEffect(() => {
		if (!shouldPollListen(phase)) return;
		const startedAt = Date.now();
		const timer = setInterval(() => {
			if (Date.now() - startedAt > LISTEN_POLL_TIMEOUT_MS) {
				setFailureText("Couldn't prepare audio - try again");
				return;
			}
			void loadState();
		}, LISTEN_POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [phase, loadState]);

	/**
	 * The manual retry, and the only thing that ever POSTs. First generations
	 * are started server-side with the day, so this is reachable from the failed
	 * card alone.
	 */
	const retry = useCallback(async () => {
		setFailureText(null);
		try {
			const result = await requestTodayCrossAudio(getToken);
			applyAudio(result);
			if (result.status === "failed") setFailureText("Couldn't prepare audio - try again");
		} catch {
			// The request itself can time out while the server is still narrating,
			// so fall back to polling rather than declaring failure here.
			void loadState();
		}
	}, [getToken, loadState, applyAudio]);

	/**
	 * Playback never started. Two things can be stale, so try the cheap one
	 * first: the bearer token the player carries lives about a minute and is
	 * only proved when it opens a connection, so a stall earns one fresh token
	 * and a rebuilt player before anything is called a failure. Failing that,
	 * a devotional state this client has been sitting on for a while earns one
	 * silent re-read. Either way they land back where they were; a source
	 * opened moments ago that stalls is a real failure and says so.
	 */
	const handlePlaybackFailure = useCallback(async () => {
		setPlayRequestedAt(null);

		if (!tokenRetriedRef.current && streamUrl) {
			tokenRetriedRef.current = true;
			resumeAtRef.current = currentTimeRef.current;
			resumePlayingRef.current = true;
			setTokenAttempt((attempt) => attempt + 1);
			return;
		}

		if (!shouldRefreshListenUrl(urlFetchedAt, refreshedRef.current)) {
			setFailureText("Couldn't prepare audio - try again");
			return;
		}
		refreshedRef.current = true;
		resumeAtRef.current = currentTimeRef.current;
		resumePlayingRef.current = true;
		try {
			const fresh = await fetchTodayCrossAudio(getToken);
			if (fresh.status === "ready" && fresh.streamUrl) {
				applyAudio(fresh);
				// The proxy path is the same string every time, so re-reading the
				// state alone would rebuild nothing and the retry would be a silent
				// no-op. Bumping the attempt is what actually builds a new player.
				setTokenAttempt((attempt) => attempt + 1);
			} else {
				setFailureText("Couldn't prepare audio - try again");
			}
		} catch {
			setFailureText("Couldn't prepare audio - try again");
		}
	}, [urlFetchedAt, streamUrl, getToken, applyAudio]);

	// Nothing playing this long after the play button means the source never
	// loaded; give a stale token, then a stale URL, one silent refresh each
	// before showing a failure.
	useEffect(() => {
		if (playRequestedAt === null) return;
		if (status.playing) {
			setPlayRequestedAt(null);
			// Playback works again: the next stall earns its own retries.
			refreshedRef.current = false;
			tokenRetriedRef.current = false;
			return;
		}
		const timer = setTimeout(() => void handlePlaybackFailure(), PLAYBACK_STALL_MS);
		return () => clearTimeout(timer);
	}, [playRequestedAt, status.playing, handlePlaybackFailure]);

	// A refreshed URL builds a new player; land it back where the dead one
	// stopped rather than at the beginning.
	useEffect(() => {
		if (!status.isLoaded || resumeAtRef.current <= 0) return;
		const resumeAt = resumeAtRef.current;
		resumeAtRef.current = 0;
		void player.seekTo(resumeAt).then(() => {
			if (!resumePlayingRef.current) return;
			resumePlayingRef.current = false;
			player.play();
			setPlayRequestedAt(Date.now());
		});
	}, [status.isLoaded, player]);

	const togglePlay = useCallback(() => {
		if (status.playing) {
			player.pause();
			setPlayRequestedAt(null);
		} else {
			player.play();
			setPlayRequestedAt(Date.now());
		}
	}, [player, status.playing]);

	const seekToFraction = useCallback(
		(fraction: number) => {
			if (duration <= 0) return;
			void player.seekTo(Math.max(0, Math.min(1, fraction)) * duration);
		},
		[player, duration]
	);

	const fractionForTouch = useCallback(
		(event: GestureResponderEvent) => {
			if (trackWidth <= 0) return 0;
			return Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
		},
		[trackWidth]
	);

	const panResponder = useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => true,
				onMoveShouldSetPanResponder: () => true,
				onPanResponderGrant: (event) => setScrubFraction(fractionForTouch(event)),
				onPanResponderMove: (event) => setScrubFraction(fractionForTouch(event)),
				onPanResponderRelease: (event) => {
					const fraction = fractionForTouch(event);
					setScrubFraction(null);
					seekToFraction(fraction);
				},
				onPanResponderTerminate: () => setScrubFraction(null),
			}),
		[fractionForTouch, seekToFraction]
	);

	const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
		setTrackWidth(event.nativeEvent.layout.width);
	}, []);

	// An unconfigured server offers nothing here - not even the rail node.
	if (phase === "hidden") return null;

	return (
		<TimelineStop glyph="♪" label="LISTEN">
			<GlassCard style={styles.card}>
				{/* A locked benefit is shown, not hidden - but with no button, because
				    there is nowhere for one to go until billing exists. */}
				{phase === "locked" ? (
					<>
						<Text style={styles.lockGlyph}>🔒</Text>
						<Text style={styles.lockTitle}>Listen is part of SureWord Pro</Text>
						<Text style={styles.lockBody}>
							A spoken devotional for every day&apos;s word, ready when you wake up.
							Coming soon.
						</Text>
					</>
				) : phase === "preparing" ? (
					<PreparingShimmer />
				) : phase === "failed" ? (
					<>
						<Text style={styles.failureText}>Couldn&apos;t prepare audio - try again</Text>
						<Pressable
							accessibilityRole="button"
							onPress={() => void retry()}
							style={({ pressed }) => [
								styles.primaryButton,
								pressed && { backgroundColor: colors.accentPressed },
							]}
						>
							<Text style={styles.primaryButtonLabel}>Try again</Text>
						</Pressable>
					</>
				) : (
					<>
						{audio?.title ? <Text style={styles.title}>{audio.title}</Text> : null}

						<View style={styles.playerRow}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={status.playing ? "Pause devotional" : "Play devotional"}
								onPress={togglePlay}
								style={({ pressed }) => [
									styles.playButton,
									pressed && { backgroundColor: colors.accentPressed },
								]}
							>
								<Text style={styles.playGlyph}>{status.playing ? "❙❙" : "▶"}</Text>
							</Pressable>

							<View style={styles.progressColumn}>
								<View
									accessibilityRole="adjustable"
									accessibilityLabel="Devotional position"
									onLayout={onTrackLayout}
									style={styles.track}
									{...panResponder.panHandlers}
								>
									<View style={styles.trackRail} />
									<View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
									<View style={[styles.trackKnob, { left: `${progress * 100}%` }]} />
								</View>
								<View style={styles.timesRow}>
									{/* Real seconds at every speed - the clock reports the file, not the pace. */}
									<Text style={styles.time}>{formatClock(elapsed)}</Text>
									<Text style={styles.time}>{formatClock(duration)}</Text>
								</View>
							</View>

							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Playback speed ${formatListenRate(listenRate)}, tap to change`}
								onPress={cycleRate}
								style={({ pressed }) => [
									styles.rateChip,
									pressed && { backgroundColor: colors.accentPressed },
								]}
							>
								<Text style={styles.rateLabel}>{formatListenRate(listenRate)}</Text>
							</Pressable>
						</View>

						{audio?.script ? (
							<>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={transcriptOpen ? "Hide transcript" : "Read along"}
									onPress={() => setTranscriptOpen((open) => !open)}
									style={styles.transcriptToggle}
								>
									<Text style={styles.transcriptToggleLabel}>
										{transcriptOpen ? "Hide transcript ▴" : "Read along ▾"}
									</Text>
								</Pressable>
								{transcriptOpen ? <Text style={styles.transcript}>{audio.script}</Text> : null}
							</>
						) : null}
					</>
				)}
			</GlassCard>
		</TimelineStop>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: { padding: spacing.lg, gap: spacing.md },
		title: { color: c.text, fontSize: 15, fontWeight: "600" },
		lockGlyph: { fontSize: 20, textAlign: "center" },
		lockTitle: { color: c.text, fontSize: 15, fontWeight: "600", textAlign: "center" },
		lockBody: {
			color: c.textFaint,
			fontSize: 13.5,
			lineHeight: 20,
			textAlign: "center",
		},
		rateChip: {
			minWidth: 56,
			height: 36,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		rateLabel: {
			color: c.accent,
			fontSize: 13,
			fontWeight: "700",
			fontVariant: ["tabular-nums"],
		},
		primaryButton: {
			minHeight: 48,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		primaryButtonLabel: { color: c.accent, fontSize: 15, fontWeight: "700" },
		preparing: { gap: spacing.sm, paddingVertical: spacing.sm },
		shimmerBar: {
			height: 12,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
		},
		preparingText: { color: c.textSecondary, fontSize: 14, textAlign: "center" },
		preparingHint: { color: c.textFaint, fontSize: 12.5, textAlign: "center" },
		failureText: { color: c.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
		playerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
		playButton: {
			width: 48,
			height: 48,
			borderRadius: 24,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			alignItems: "center",
			justifyContent: "center",
		},
		playGlyph: { color: c.accent, fontSize: 16, fontWeight: "700" },
		progressColumn: { flex: 1, gap: 6 },
		// The touch target is 22pt tall so it can be grabbed; the rail drawn
		// inside it is 4pt, centred by hand because absolute children ignore
		// the container's justifyContent.
		track: { height: 22 },
		trackRail: {
			position: "absolute",
			top: 9,
			left: 0,
			right: 0,
			height: 4,
			borderRadius: 2,
			backgroundColor: c.borderStrong,
		},
		trackFill: {
			position: "absolute",
			top: 9,
			left: 0,
			height: 4,
			borderRadius: 2,
			backgroundColor: c.accent,
		},
		trackKnob: {
			position: "absolute",
			top: 5,
			width: 12,
			height: 12,
			marginLeft: -6,
			borderRadius: 6,
			backgroundColor: c.accent,
		},
		timesRow: { flexDirection: "row", justifyContent: "space-between" },
		time: { color: c.textFaint, fontSize: 12, fontVariant: ["tabular-nums"] },
		transcriptToggle: { paddingVertical: spacing.xs },
		transcriptToggleLabel: { color: c.accentDim, fontSize: 13, fontWeight: "600" },
		transcript: { color: c.textSecondary, fontSize: 14.5, lineHeight: 23 },
	});

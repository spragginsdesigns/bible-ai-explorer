import { useCallback, useEffect, useRef } from "react";
import type { AudioPlayer } from "expo-audio";
import { VoiceAudioPlayback } from "./VoiceAudioPlayback";

/** Own one guard per Expo native player, including token/source replacements. */
export function useVoiceAudioPlayback(player: AudioPlayer, onError: (error: unknown) => void) {
	const latestError = useRef(onError); latestError.current = onError;
	const guard = useRef<{ player: AudioPlayer; playback: VoiceAudioPlayback } | null>(null);
	useEffect(() => {
		const entry = { player, playback: new VoiceAudioPlayback(player, (error) => latestError.current(error)) };
		guard.current = entry;
		return () => { if (guard.current === entry) guard.current = null; entry.playback.dispose(); };
	}, [player]);
	const play = useCallback(() => guard.current?.player === player ? guard.current.playback.play() : Promise.resolve(false), [player]);
	const pause = useCallback(() => { if (guard.current?.player === player) guard.current.playback.pause(); }, [player]);
	return { play, pause };
}

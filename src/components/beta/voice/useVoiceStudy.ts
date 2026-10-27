"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { VoiceStudyEngine, type VoiceSnapshot } from "./voiceEngine";

/**
 * Voice Study's React binding: one engine per page, its snapshots as state,
 * and the microphone level written straight to a CSS variable on `levelRef`
 * (no re-render per animation frame). Leaving the page ends the conversation
 * and keeps it.
 */
export function useVoiceStudy(levelRef: RefObject<HTMLElement | null>) {
	const engineRef = useRef<VoiceStudyEngine | null>(null);
	const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);

	const engine = useCallback((): VoiceStudyEngine => {
		engineRef.current ??= new VoiceStudyEngine(setSnapshot, (level) => {
			levelRef.current?.style.setProperty("--voice-level", level.toFixed(3));
		});
		return engineRef.current;
	}, [levelRef]);

	useEffect(() => {
		const leave = () => engineRef.current?.dispose();
		window.addEventListener("pagehide", leave);
		return () => {
			window.removeEventListener("pagehide", leave);
			leave();
			engineRef.current = null;
		};
	}, []);

	return {
		snapshot: snapshot ?? engine().state,
		start: () => void engine().start(),
		end: () => void engine().end("user"),
		setMuted: (muted: boolean) => engine().setMuted(muted),
		saveNote: () => void engine().saveNote(),
	};
}

/**
 * The browser's own record of the microphone permission, read without asking
 * for it, so a blocked microphone is explained before the first tap. Browsers
 * without the Permissions API (or without "microphone" in it) answer "unknown".
 */
export function useMicPermission(): PermissionState | "unknown" {
	const [state, setState] = useState<PermissionState | "unknown">("unknown");
	useEffect(() => {
		let status: PermissionStatus | null = null;
		const update = () => status && setState(status.state);
		navigator.permissions
			?.query({ name: "microphone" as PermissionName })
			.then((result) => {
				status = result;
				update();
				result.addEventListener("change", update);
			})
			.catch(() => setState("unknown"));
		return () => status?.removeEventListener("change", update);
	}, []);
	return state;
}

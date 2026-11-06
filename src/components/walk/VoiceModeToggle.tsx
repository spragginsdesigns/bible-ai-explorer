"use client";

import React, { useEffect, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { readVoiceModePref } from "@/lib/preferences";
import { setVoiceModePreference, usePreference } from "@/lib/preferencesSync";

/** Set once the reader closes the toggle; per browser, like the phone's per-device choice. */
const DISMISSED_KEY = "sureword.welcomeVoiceBarDismissed";

function readDismissed(): boolean {
	try {
		return window.localStorage.getItem(DISMISSED_KEY) === "1";
	} catch {
		return false;
	}
}

/**
 * "Read it to me", at the top of the welcome conversation. Off by default and
 * saved to the account, so it carries to the phone; the reading itself is
 * `useWelcomeVoice`. The X closes it and turns reading off, matching
 * Android's WelcomeVoiceBar (Austin, 2026-11-06: no way to get rid of it).
 */
export default function VoiceModeToggle() {
	const enabled = usePreference(readVoiceModePref, false);
	const [dismissed, setDismissed] = useState(true);
	useEffect(() => setDismissed(readDismissed()), []);
	if (dismissed) return null;
	const close = () => {
		if (enabled) void setVoiceModePreference(false);
		try {
			window.localStorage.setItem(DISMISSED_KEY, "1");
		} catch {
			// Storage blocked: it stays closed for this page view only.
		}
		setDismissed(true);
	};
	return (
		<div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-1 px-4 pt-2">
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				onClick={() => void setVoiceModePreference(!enabled)}
				className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-semibold transition-colors ${
					enabled
						? "border-amber-600/50 bg-amber-500/10 text-amber-800 dark:border-amber-300/40 dark:bg-amber-300/10 dark:text-amber-200"
						: "border-black/[0.12] text-neutral-700 hover:bg-black/[0.04] dark:border-white/[0.12] dark:text-neutral-300 dark:hover:bg-white/[0.05]"
				}`}
			>
				{enabled ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
				Read it to me
			</button>
			<button
				type="button"
				aria-label="Close Read it to me"
				onClick={close}
				className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 hover:bg-black/[0.04] dark:text-neutral-400 dark:hover:bg-white/[0.05]"
			>
				<X className="h-5 w-5" aria-hidden />
			</button>
		</div>
	);
}

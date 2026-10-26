"use client";

import React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { readVoiceModePref } from "@/lib/preferences";
import { setVoiceModePreference, usePreference } from "@/lib/preferencesSync";

/**
 * "Read it to me", at the top of the welcome conversation. Off by default and
 * saved to the account, so it carries to the phone; the reading itself is
 * `useWelcomeVoice`.
 */
export default function VoiceModeToggle() {
	const enabled = usePreference(readVoiceModePref, false);
	return (
		<div className="mx-auto flex w-full max-w-3xl justify-end px-4 pt-2">
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
		</div>
	);
}

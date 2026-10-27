"use client";

import { useEffect } from "react";
import { readTextScalePref } from "@/lib/preferences";
import { notifyPreferencesChanged, usePreference } from "@/lib/preferencesSync";
import { DEFAULT_TEXT_SCALE, TEXT_SCALE_PREF_KEY, applyTextScaleToDocument } from "@/lib/text-scale";

/**
 * Keeps <html> at the account's text size. Mounted once from the root layout:
 * the boot script there sets the size before the first paint, and this takes
 * over afterwards, so a change in Settings, on the welcome card or on another
 * device (through the preference hydrate) resizes the app at once. Signing
 * out clears the cache, which reads back as the standard size.
 */
export default function TextScaleRoot() {
	const scale = usePreference(readTextScalePref, DEFAULT_TEXT_SCALE);
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (event.key === TEXT_SCALE_PREF_KEY || event.key === null) notifyPreferencesChanged();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);
	useEffect(() => {
		// Read the cache itself, not `scale`: the hydration pass renders the
		// server's standard size first, and applying that would undo the boot
		// script for a frame.
		applyTextScaleToDocument(readTextScalePref());
	}, [scale]);
	return null;
}

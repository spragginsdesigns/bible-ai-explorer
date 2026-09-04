"use client";

import React, { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { X } from "lucide-react";
import {
	adoptOrHydratePreferences,
	claimPreferencesCache,
	clearSyncedPreferences,
	dismissPreferencesSyncError,
	hydratePreferences,
	usePreferencesSyncError,
} from "@/lib/preferencesSync";

/**
 * Keeps this browser's preference cache level with the account.
 *
 * Mounted once from the root layout, so every route gets the same behaviour:
 * hydrate on sign-in and on every return to the foreground, discard the cache
 * when a different account signs in, and show a small notice when a write did
 * not reach the server. It renders nothing else.
 */
function usePreferencesSync(): void {
	const { isLoaded, isSignedIn, userId } = useAuth();

	useEffect(() => {
		if (!isLoaded) return;
		if (!isSignedIn || !userId) {
			// Signed out: the next person to use this browser must not inherit
			// this account's translation, model or toggles as their first paint.
			clearSyncedPreferences();
			return;
		}
		// Claim first: an account switch has to clear the cache before anything
		// reads it, or this account would adopt the last one's choices.
		claimPreferencesCache(userId);
		void adoptOrHydratePreferences(userId);
	}, [isLoaded, isSignedIn, userId]);

	useEffect(() => {
		if (!isSignedIn) return;
		// Coming back to the tab is the moment a change made on the phone should
		// appear. Both events fire for the same wake, which the 15s throttle
		// inside hydratePreferences collapses into one request.
		const onWake = () => {
			if (document.visibilityState !== "visible") return;
			void hydratePreferences();
		};
		window.addEventListener("focus", onWake);
		document.addEventListener("visibilitychange", onWake);
		return () => {
			window.removeEventListener("focus", onWake);
			document.removeEventListener("visibilitychange", onWake);
		};
	}, [isSignedIn]);
}

export default function PreferencesSync() {
	usePreferencesSync();
	const error = usePreferencesSyncError();

	if (!error) return null;

	// Non-blocking on purpose: the local value has already been rolled back, so
	// this only has to say the setting did not stick. Sits above the mobile tab
	// bar so it never covers the nav.
	return (
		<div
			role="status"
			className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-red-500/25 bg-white/95 px-4 py-3 shadow-lg backdrop-blur dark:border-red-400/20 dark:bg-neutral-900/95 lg:bottom-6"
		>
			<p className="min-w-0 flex-1 text-[13px] text-red-600 dark:text-red-400">{error}</p>
			<button
				type="button"
				onClick={dismissPreferencesSyncError}
				aria-label="Dismiss"
				className="flex-shrink-0 text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}

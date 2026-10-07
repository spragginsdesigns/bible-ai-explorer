import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useShareIntent } from "expo-share-intent";
import { planSharedChat } from "./shareIntake";
import { setPendingShare } from "./shareInbox";

// Android only: the iOS share extension is disabled in app.json, and the
// Apple apps are native Swift, not this Expo build.
const SHARE_INTENT_OPTIONS: Parameters<typeof useShareIntent>[0] = {
	disabled: Platform.OS !== "android",
};

/**
 * Receives "Share into SureWord" from other apps. The share is decided on and
 * parked in the inbox at once, then cleared natively so it is never applied
 * twice; the chat screen opens it as a new chat. Signed out, the user stays on
 * sign-in and the share waits, because sign-in lands on the chat.
 */
export function ShareIntentBridge(): null {
	const { isSignedIn } = useAuth();
	const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent(SHARE_INTENT_OPTIONS);
	// The hook hands back a new reset function on every render.
	const resetRef = useRef(resetShareIntent);
	resetRef.current = resetShareIntent;
	const signedInRef = useRef(isSignedIn);
	signedInRef.current = isSignedIn;

	useEffect(() => {
		if (!hasShareIntent) return;
		setPendingShare(planSharedChat(shareIntent));
		resetRef.current();
		if (!signedInRef.current) return;
		try {
			router.navigate("/");
		} catch {
			// The navigator is not mounted yet on a cold start, which opens on
			// the chat anyway.
		}
	}, [hasShareIntent, shareIntent]);

	return null;
}

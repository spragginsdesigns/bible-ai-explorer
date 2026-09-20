import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import * as Font from "expo-font";
import { useFonts, PirataOne_400Regular } from "@expo-google-fonts/pirata-one";
import {
	AtkinsonHyperlegible_400Regular,
	AtkinsonHyperlegible_400Regular_Italic,
	AtkinsonHyperlegible_700Bold,
	AtkinsonHyperlegible_700Bold_Italic,
} from "@expo-google-fonts/atkinson-hyperlegible";
import {
	CormorantGaramond_500Medium,
	CormorantGaramond_500Medium_Italic,
} from "@expo-google-fonts/cormorant-garamond";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PostHogProvider } from "posthog-react-native";
import { CLERK_PUBLISHABLE_KEY, setAuthFailureHandler, setRequestFailureReporter } from "@/lib/api";
import { analytics, identify, resetAnalytics, trackRequestFailure } from "@/lib/analytics";
import { useScreenTracking } from "@/features/analytics/useScreenTracking";
import { hydrateSettings, useTheme } from "@/features/settings/settingsStore";
import { usePreferencesLifecycle } from "@/features/settings/preferencesSync";
import { hydrateHighlights } from "@/features/bible/highlightsStore";
import { hydrateNotificationSettings } from "@/features/notifications/notificationSettings";
import { AnimatedSplash } from "@/components/AnimatedSplash";
import {
	markLaunchAnimationStartedThisSession,
	shouldShowLaunchAnimationThisSession,
} from "@/components/launchAnimationSession";

SplashScreen.preventAutoHideAsync().catch(() => {});

const Hack_400Regular = require("../assets/fonts/Hack-Regular.ttf");
const Hack_400Regular_Italic = require("../assets/fonts/Hack-Italic.ttf");
const Hack_700Bold = require("../assets/fonts/Hack-Bold.ttf");
const Hack_700Bold_Italic = require("../assets/fonts/Hack-BoldItalic.ttf");

/** Module-level so a remount (or a strict-mode double effect) cannot re-request
 * the deferred faces that are already registered. */
let deferredFontsRequested = false;

/**
 * Signs out locally when the API reports auth failure (a 401 that survives
 * the fresh-token retry — the signature of a session cached from another
 * Clerk instance). The (app) layout then redirects to /sign-in on its own,
 * so a stale session can never masquerade as "signed in but nothing works".
 */
function AuthFailureBridge({ children }: { children: React.ReactNode }) {
	const { signOut } = useAuth();

	// Sits here rather than in the (app) shell because signing out unmounts that
	// shell: the cache clear has to be watched from above it.
	usePreferencesLifecycle();

	useEffect(() => {
		setAuthFailureHandler(() => {
			void signOut();
		});
		return () => setAuthFailureHandler(null);
	}, [signOut]);

	// api.ts cannot import the analytics module without dragging native modules
	// into its unit tests, so the reporter is handed to it from here.
	useEffect(() => {
		setRequestFailureReporter(trackRequestFailure);
		return () => setRequestFailureReporter(null);
	}, []);

	return <>{children}</>;
}

/**
 * Ties this device's events to the signed-in account, and unties them on sign
 * out so the next person to use the phone does not inherit the trail.
 *
 * Sits beside AuthFailureBridge rather than inside the (app) shell for the
 * same reason that one does: signing out unmounts that shell, and the reset
 * has to happen from above it.
 */
function AnalyticsIdentityBridge(): null {
	const { isLoaded, isSignedIn, userId } = useAuth();
	/**
	 * Who was signed in last time this ran, so a sign-OUT can be told apart
	 * from merely being signed out.
	 *
	 * Clerk reports signed-out for a beat on every cold start before it
	 * restores the session, and `reset()` mints a new anonymous id and
	 * abandons the old one. Resetting on the bare signed-out state therefore
	 * orphaned the launch's own `Application Installed` and `Application
	 * Opened` on a person nothing ever merged with, and wiped the persisted
	 * install marker so the next launch called itself an install too. Measured
	 * on Austin's own phone on 2026-09-20: the id changed 3.4 seconds after
	 * launch with no identify in between, and six launches had become six new
	 * users. Same fix, same reasoning, in
	 * src/components/analytics/AnalyticsProvider.tsx.
	 */
	const previousUserId = useRef<string | null>(null);

	useEffect(() => {
		if (!isLoaded) return;
		if (isSignedIn && userId) {
			previousUserId.current = userId;
			identify(userId);
			return;
		}
		// Only a real sign-out resets. A first run keeps its anonymous trail so
		// that install, first open and first screen merge into the account when
		// one is created, which is the entire activation funnel.
		if (previousUserId.current) {
			resetAnalytics();
			previousUserId.current = null;
		}
	}, [isLoaded, isSignedIn, userId]);

	return null;
}

/** Reports every route change as `screen_viewed`. See useScreenTracking. */
function AnalyticsScreenBridge(): null {
	useScreenTracking();
	return null;
}

/** Chrome that follows the appearance setting: status bar + window background. */
function ThemedShell() {
	const { colors, isDark } = useTheme();

	useEffect(() => {
		SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
	}, [colors.bg]);

	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
			<StatusBar style={isDark ? "light" : "dark"} />
			<Stack
				screenOptions={{
					headerShown: false,
					contentStyle: { backgroundColor: colors.bg },
					animation: "fade",
				}}
			/>
		</GestureHandlerRootView>
	);
}

export default function RootLayout() {
	// Only the four faces the first frame can actually paint hold the splash:
	// upright body text, its bold, the brand title and upright Scripture.
	const [fontsLoaded] = useFonts({
		PirataOne_400Regular,
		AtkinsonHyperlegible_400Regular,
		AtkinsonHyperlegible_700Bold,
		CormorantGaramond_500Medium,
	});
	const [settingsReady, setSettingsReady] = useState(false);
	const [showAnimatedSplash, setShowAnimatedSplash] = useState(
		shouldShowLaunchAnimationThisSession,
	);

	useEffect(() => {
		Promise.all([hydrateSettings(), hydrateHighlights(), hydrateNotificationSettings()])
			.catch(() => {})
			.finally(() => setSettingsReady(true));
	}, []);

	// The remaining seven faces - every italic plus the whole Hack family
	// (~1.27 MB, code blocks only) - are registered under the same names right
	// after the blocking set resolves, while the intro animation is on screen.
	// Android's new architecture renders a not-yet-loaded family in the system
	// font rather than crashing, so the worst case is a brief substitution.
	useEffect(() => {
		if (!fontsLoaded || deferredFontsRequested) return;
		deferredFontsRequested = true;
		Font.loadAsync({
			AtkinsonHyperlegible_400Regular_Italic,
			AtkinsonHyperlegible_700Bold_Italic,
			Hack_400Regular,
			Hack_400Regular_Italic,
			Hack_700Bold,
			Hack_700Bold_Italic,
			CormorantGaramond_500Medium_Italic,
		}).catch(() => {
			// Cosmetic: an unregistered face falls back to the system font.
		});
	}, [fontsLoaded]);

	useEffect(() => {
		if (fontsLoaded && settingsReady) SplashScreen.hideAsync().catch(() => {});
	}, [fontsLoaded, settingsReady]);

	useEffect(() => {
		if (showAnimatedSplash) markLaunchAnimationStartedThisSession();
	}, [showAnimatedSplash]);

	if (!fontsLoaded || !settingsReady) return null;

	return (
		<ClerkProvider
			publishableKey={CLERK_PUBLISHABLE_KEY}
			tokenCache={tokenCache}
			// Clerk's encrypted resource cache restores the existing account on
			// offline cold starts, so reading stays attributed to its owner.
			__experimental_resourceCache={resourceCache}
		>
			<AuthFailureBridge>
				{/* Screen views and app-open/background, and nothing else: touch
				    autocapture would record the text of whatever was tapped,
				    which in this app is a verse or somebody's saved question.
				    See mobile/src/lib/analytics.ts. */}
				{/* captureScreens is off because it never worked here: it hooks a
				    React Navigation container and expo-router owns its own below
				    this provider, so it produced no screen events at all.
				    AnalyticsScreenBridge sends them from the router instead. */}
				<PostHogProvider
					client={analytics ?? undefined}
					autocapture={{ captureScreens: false, captureTouches: false }}
				>
					<AnalyticsIdentityBridge />
					<AnalyticsScreenBridge />
					<View style={{ flex: 1 }}>
						<ThemedShell />
						{showAnimatedSplash ? (
							<AnimatedSplash onFinish={() => setShowAnimatedSplash(false)} />
						) : null}
					</View>
				</PostHogProvider>
			</AuthFailureBridge>
		</ClerkProvider>
	);
}

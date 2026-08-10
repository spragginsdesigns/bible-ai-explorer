import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { useFonts, PirataOne_400Regular } from "@expo-google-fonts/pirata-one";
import {
	CormorantGaramond_500Medium,
	CormorantGaramond_500Medium_Italic,
} from "@expo-google-fonts/cormorant-garamond";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { CLERK_PROXY_URL, CLERK_PUBLISHABLE_KEY, setAuthFailureHandler } from "@/lib/api";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Signs out locally when the API reports auth failure (a 401 that survives
 * the fresh-token retry — the signature of a session cached from another
 * Clerk instance). The (app) layout then redirects to /sign-in on its own,
 * so a stale session can never masquerade as "signed in but nothing works".
 */
function AuthFailureBridge({ children }: { children: React.ReactNode }) {
	const { signOut } = useAuth();

	useEffect(() => {
		setAuthFailureHandler(() => {
			void signOut();
		});
		return () => setAuthFailureHandler(null);
	}, [signOut]);

	return <>{children}</>;
}

export default function RootLayout() {
	const [fontsLoaded] = useFonts({
		PirataOne_400Regular,
		CormorantGaramond_500Medium,
		CormorantGaramond_500Medium_Italic,
	});

	useEffect(() => {
		if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
	}, [fontsLoaded]);

	if (!fontsLoaded) return null;

	return (
		<ClerkProvider
			publishableKey={CLERK_PUBLISHABLE_KEY}
			proxyUrl={CLERK_PROXY_URL}
			tokenCache={tokenCache}
		>
			<AuthFailureBridge>
				<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
					<StatusBar style="light" />
					<Stack
						screenOptions={{
							headerShown: false,
							contentStyle: { backgroundColor: colors.bg },
							animation: "fade",
						}}
					/>
				</GestureHandlerRootView>
			</AuthFailureBridge>
		</ClerkProvider>
	);
}

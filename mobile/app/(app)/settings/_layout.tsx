import React from "react";
import { Stack } from "expo-router/stack";
import { useTheme } from "@/features/settings/settingsStore";

/**
 * Deep links straight to a category (the model picker's "add a key", a
 * memory or church receipt) mount the hub beneath the page, so back never
 * skips the hub.
 */
export const unstable_settings = { anchor: "index" };

/**
 * Nested stack so Settings can push its category pages while the tab bar
 * (owned by the parent (app) layout) keeps treating "settings" as the one
 * push-only route it always was.
 */
export default function SettingsLayout() {
	const { colors } = useTheme();
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Screen name="index" />
			<Stack.Screen name="appearance" />
			<Stack.Screen name="memory" />
			<Stack.Screen name="highlights" />
			<Stack.Screen name="ai" />
			<Stack.Screen name="church" />
			<Stack.Screen name="notifications" />
			<Stack.Screen name="shared" />
			<Stack.Screen name="account" />
			<Stack.Screen name="about" />
		</Stack>
	);
}

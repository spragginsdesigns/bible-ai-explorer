import React from "react";
import { Stack } from "expo-router/stack";
import { useTheme } from "@/features/settings/settingsStore";

// Deep links from chat, notifications, and the legacy /cross URL must leave
// the Bible home beneath the destination so Android Back returns to Bible.
export const unstable_settings = { anchor: "index" };

/**
 * Nested stack so the bible tab can push the chapter grid and reading screens
 * while the tab bar (owned by the parent (app) layout) keeps treating "bible"
 * as a single route.
 */
export default function BibleLayout() {
	const { colors } = useTheme();
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Screen name="index" />
			<Stack.Screen name="chapters" />
			<Stack.Screen name="chapter" />
			<Stack.Screen name="cross" />
			<Stack.Screen name="search" />
			<Stack.Screen name="plan" />
			<Stack.Screen name="timeline" />
			<Stack.Screen name="atlas/[id]" />
			<Stack.Screen name="atlas/event/[id]" />
			<Stack.Screen name="atlas/family/[id]" />
			<Stack.Screen name="atlas/trace/[id]" />
		</Stack>
	);
}

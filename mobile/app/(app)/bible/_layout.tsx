import React from "react";
import { Stack } from "expo-router/stack";
import { colors } from "@/theme";

/**
 * Nested stack so the bible tab can push the chapter grid and reading screens
 * while the tab bar (owned by the parent (app) layout) keeps treating "bible"
 * as a single route.
 */
export default function BibleLayout() {
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
			<Stack.Screen name="search" />
		</Stack>
	);
}

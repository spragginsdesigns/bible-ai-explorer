import React from "react";
import { Stack } from "expo-router/stack";
import { colors } from "@/theme";

/**
 * Nested stack so the notes tab can push the editor while the tab bar (owned by
 * the parent (app) layout) keeps treating "notes" as a single route.
 */
export default function NotesLayout() {
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: colors.bg },
			}}
		>
			<Stack.Screen name="index" />
			<Stack.Screen name="[id]" />
		</Stack>
	);
}

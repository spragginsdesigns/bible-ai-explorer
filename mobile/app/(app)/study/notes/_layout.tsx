import React from "react";
import { Stack } from "expo-router/stack";
import { useTheme } from "@/features/settings/settingsStore";

// A render crash shows a Try again screen in place of this route instead of closing the app.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

/**
 * Deep links straight to a note (chat's "note added" card, retrieved-verse
 * cards) mount the hub beneath the editor, so back never skips the hub.
 */
export const unstable_settings = { anchor: "index" };

/**
 * Nested stack so the notes tab can push the editor while the tab bar (owned by
 * the parent (app) layout) keeps treating "notes" as a single route.
 */
export default function NotesLayout() {
	const { colors } = useTheme();
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

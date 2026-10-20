import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/features/settings/settingsStore";
export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";
export const unstable_settings = { anchor: "index" };

export default function StudyLayout() {
	const { colors } = useTheme();
	return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}

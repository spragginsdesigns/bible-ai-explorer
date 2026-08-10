import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";

const TAB_LABELS: Record<string, string> = {
	index: "Chat",
	bible: "Bible",
	notes: "Notes",
};

const TAB_GLYPHS: Record<string, string> = {
	index: "✦",
	bible: "✝",
	notes: "✎",
};

function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
	const insets = useSafeAreaInsets();
	const { colors, isDark } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View style={[styles.tabBarWrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
			<BlurView intensity={40} tint={isDark ? "dark" : "light"} style={styles.tabBar}>
				{state.routes.map((route: { key: string; name: string }, index: number) => {
					// Routes hidden with options.href === null (e.g. push-only screens)
					// must not render in the bar.
					if (descriptors[route.key]?.options?.href === null) return null;
					const focused = state.index === index;
					const label = TAB_LABELS[route.name] ?? route.name;
					return (
						<Pressable
							key={route.key}
							accessibilityRole="tab"
							accessibilityState={{ selected: focused }}
							onPress={() => {
								if (!focused) navigation.navigate(route.name);
							}}
							style={({ pressed }) => [
								styles.tabItem,
								focused && styles.tabItemActive,
								pressed && { opacity: 0.7 },
							]}
						>
							<Text style={[styles.tabGlyph, focused && { color: colors.accent }]}>
								{TAB_GLYPHS[route.name] ?? "•"}
							</Text>
							<Text style={[styles.tabLabel, focused && { color: colors.accent }]}>{label}</Text>
						</Pressable>
					);
				})}
			</BlurView>
		</View>
	);
}

export default function AppLayout() {
	const { isLoaded, isSignedIn } = useAuth();
	const { colors } = useTheme();

	if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

	return (
		<Tabs
			tabBar={(props) => <GlassTabBar {...props} />}
			screenOptions={{
				headerShown: false,
				sceneStyle: { backgroundColor: colors.bg },
			}}
		>
			<Tabs.Screen name="index" />
			<Tabs.Screen name="bible" />
			<Tabs.Screen name="notes" />
			{/* Push-only screen: reachable from the chat header gear, hidden from the tab bar. */}
			<Tabs.Screen name="settings" options={{ href: null }} />
		</Tabs>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		tabBarWrap: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			paddingHorizontal: spacing.xl,
			backgroundColor: "transparent",
		},
		tabBar: {
			flexDirection: "row",
			borderRadius: 24,
			overflow: "hidden",
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.glass,
		},
		tabItem: {
			flex: 1,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			paddingVertical: 14,
		},
		tabItemActive: {
			backgroundColor: c.accentSoft,
		},
		tabGlyph: { color: c.textFaint, fontSize: 15 },
		tabLabel: { color: c.textFaint, fontSize: 13, fontWeight: "600" },
	});

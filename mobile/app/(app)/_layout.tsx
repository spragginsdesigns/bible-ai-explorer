import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { radius, spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useVerseOfDayNotifications } from "@/features/notifications/useVerseOfDayNotifications";
import { useInAppUpdates } from "@/features/updates/inAppUpdates";
import { isPrimaryTabRoute, type PrimaryTabRoute } from "@/lib/primaryTabs";

const TAB_LABELS: Record<PrimaryTabRoute, string> = {
	index: "Chat",
	bible: "Bible",
	notes: "Notes",
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type TabRoute = { key: string; name: string };
type TabRouteEntry = { route: TabRoute; index: number };

const TAB_ICONS: Record<
	PrimaryTabRoute,
	{ active: IoniconName; inactive: IoniconName }
> = {
	index: {
		active: "chatbubble-ellipses",
		inactive: "chatbubble-ellipses-outline",
	},
	bible: { active: "book", inactive: "book-outline" },
	notes: { active: "document-text", inactive: "document-text-outline" },
};

function SolidTabBar({ state, navigation }: BottomTabBarProps) {
	const insets = useSafeAreaInsets();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const primaryRoutes: TabRouteEntry[] = state.routes
		.map((route: TabRoute, index: number) => ({ route, index }))
		.filter(({ route }: TabRouteEntry) => isPrimaryTabRoute(route.name));

	return (
		<View
			style={[
				styles.tabBarWrap,
				{ paddingBottom: Math.max(insets.bottom, spacing.sm) },
			]}
		>
			<View style={styles.tabBar}>
				{primaryRoutes.map(({ route, index }) => {
					const focused = state.index === index;
					const routeName = route.name as PrimaryTabRoute;
					const label = TAB_LABELS[routeName];
					const icon = TAB_ICONS[routeName];
					return (
						<Pressable
							key={route.key}
							accessibilityRole="tab"
							accessibilityLabel={`${label} tab`}
							accessibilityState={{ selected: focused }}
							onPress={() => {
								const event = navigation.emit({
									type: "tabPress",
									target: route.key,
									canPreventDefault: true,
								});
								if (!focused && !event.defaultPrevented)
									navigation.navigate(route.name);
							}}
							style={({ pressed }) => [
								styles.tabItem,
								focused && styles.tabItemActive,
								pressed && { opacity: 0.7 },
							]}
						>
							<Ionicons
								name={focused ? icon.active : icon.inactive}
								size={21}
								color={focused ? colors.accent : colors.textFaint}
							/>
							<Text
								style={[styles.tabLabel, focused && { color: colors.accent }]}
							>
								{label}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}

export default function AppLayout() {
	const { isLoaded, isSignedIn } = useAuth();
	const { colors } = useTheme();
	// Verse-of-the-day: push-token registration + notification tap deep links.
	useVerseOfDayNotifications();
	// Play in-app updates: background-download a newer build and self-install.
	useInAppUpdates();

	if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

	return (
		<Tabs
			tabBar={(props) => <SolidTabBar {...props} />}
			// Back returns to the previously focused screen instead of always
			// falling out to the first tab (chat).
			backBehavior="history"
			screenOptions={{
				headerShown: false,
				sceneStyle: { backgroundColor: colors.bg },
			}}
		>
			<Tabs.Screen name="index" />
			<Tabs.Screen name="bible" />
			{/* Reset the nested notes stack when leaving, so the tab always reopens on the hub. */}
			<Tabs.Screen name="notes" options={{ popToTopOnBlur: true }} />
			{/* Push-only screen: reachable from the chat header gear, hidden from the tab bar. */}
			<Tabs.Screen name="settings" options={{ href: null }} />
			{/* Push-only screen: reachable from Settings → Manage memories. */}
			<Tabs.Screen name="memories" options={{ href: null }} />
			{/* Push-only screen: reachable from the Bible tab, chat cards, and the morning notification. */}
			<Tabs.Screen name="cross" options={{ href: null }} />
		</Tabs>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		// Docked, fully opaque bar. It used to be a floating BlurView pill, but
		// Android renders expo-blur as plain translucency, so the list scrolled
		// through it as ghost text.
		tabBarWrap: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.borderStrong,
			backgroundColor: c.bgElevated,
		},
		tabBar: {
			flexDirection: "row",
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.sm,
			gap: spacing.xs,
		},
		tabItem: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			gap: 3,
			minHeight: 52,
			borderRadius: radius.lg,
		},
		tabItemActive: {
			backgroundColor: c.accentSoft,
		},
		tabLabel: { color: c.textFaint, fontSize: 11, fontWeight: "600" },
	});

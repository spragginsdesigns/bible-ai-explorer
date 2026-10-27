import React, { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { radius, spacing, typography, type Colors } from "@/theme";
import { TAB_BAR_ITEM_HEIGHT, recordTabBarHeight } from "@/features/chat/layout";
import { chatColors } from "@/features/chat/chatAppearance";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { usePreferencesSync } from "@/features/settings/preferencesSync";
import { AIConsentPresenter } from "@/features/settings/AIConsentPresenter";
import { WhatsNewPresenter } from "@/features/whatsNew/WhatsNewPresenter";
import { usePushNotifications } from "@/features/notifications/usePushNotifications";
import { useReadingLogSync } from "@/features/reading/readingLogStore";
import { useInAppUpdates } from "@/features/updates/inAppUpdates";
import { isPrimaryTabRoute, type PrimaryTabRoute } from "@/lib/primaryTabs";
import { afterTabDepartureGuard } from "@/lib/tabDeparture";
import { SpotlightAnchor, SpotlightOverlay } from "@/features/onboarding/Spotlight";
import { WelcomeLauncher } from "@/features/onboarding/WelcomeLauncher";

// A render crash shows a Try again screen in place of this route instead of closing the app.
export { RouteErrorBoundary as ErrorBoundary } from "@/components/RouteErrorBoundary";

const TAB_LABELS: Record<PrimaryTabRoute, string> = {
	today: "Today",
	index: "Chat",
	bible: "Bible",
	connections: "Connections",
	study: "Study",
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type TabRoute = { key: string; name: string };
type TabRouteEntry = { route: TabRoute; index: number };

/** The spotlight's name for each tab (the Walk with me tour). */
const TAB_TARGETS: Record<PrimaryTabRoute, string> = {
	today: "tab.today",
	index: "tab.chat",
	bible: "tab.bible",
	connections: "tab.connections",
	study: "tab.study",
};

const TAB_ICONS: Record<
	PrimaryTabRoute,
	{ active: IoniconName; inactive: IoniconName }
> = {
	today: { active: "sunny", inactive: "sunny-outline" },
	index: {
		active: "chatbubble-ellipses",
		inactive: "chatbubble-ellipses-outline",
	},
	bible: { active: "book", inactive: "book-outline" },
	connections: { active: "git-network", inactive: "git-network-outline" },
	study: { active: "compass", inactive: "compass-outline" },
};

export function SolidTabBar({ state, navigation }: BottomTabBarProps) {
	const departing = useRef(false);
	const insets = useSafeAreaInsets();
	const { colors: themeColors } = useTheme();
	const colors = chatColors(themeColors);
	const styles = useThemedStyles(createStyles);
	const primaryRoutes: TabRouteEntry[] = state.routes
		.map((route: TabRoute, index: number) => ({ route, index }))
		.filter(({ route }: TabRouteEntry) => isPrimaryTabRoute(route.name));

	return (
		<View
			onLayout={event => recordTabBarHeight(event.nativeEvent.layout.height)}
			style={[
				styles.tabBarWrap,
				{ backgroundColor: colors.bgElevated, borderTopColor: colors.borderStrong },
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
						<SpotlightAnchor
							key={route.key}
							target={TAB_TARGETS[routeName]}
							style={styles.tabSlot}
						>
						<Pressable
							accessibilityRole="tab"
							accessibilityLabel={`${label} tab`}
							accessibilityState={{ selected: focused }}
							onPress={() => {
								if (departing.current) return;
								departing.current = true;
								void afterTabDepartureGuard(() => {
									const event = navigation.emit({
									type: "tabPress",
									target: route.key,
									canPreventDefault: true,
									});
									if (!focused && !event.defaultPrevented)
										navigation.navigate(route.name);
								}).finally(() => { departing.current = false; });
							}}
							style={({ pressed }) => [
								styles.tabItem,
								focused && { backgroundColor: colors.accentSoft },
								pressed && { opacity: 0.7 },
							]}
						>
							<Ionicons
								name={focused ? icon.active : icon.inactive}
								size={24}
								color={focused ? colors.accent : colors.textMuted}
							/>
							<Text
								numberOfLines={1}
								style={[styles.tabLabel, { color: focused ? colors.accent : colors.textMuted }]}
							>
								{label}
							</Text>
							{focused ? <View style={[styles.chatIndicator, { backgroundColor: colors.accent }]} /> : null}
						</Pressable>
						</SpotlightAnchor>
					);
				})}
			</View>
		</View>
	);
}

export default function AppLayout() {
	const { isLoaded, isSignedIn } = useAuth();
	const { colors } = useTheme();
	// Account preferences: hydrate the server document, write every change back,
	// and keep the persisted caches tied to the account that owns them.
	usePreferencesSync();
	useReadingLogSync();
	// Verse-of-the-day: push-token registration + notification tap deep links.
	// Never prompts on mount; the permission dialog waits for a first settled
	// answer or Cross visit (see features/notifications/permissionPrompt).
	usePushNotifications();
	// Play in-app updates: background-download a newer build and self-install.
	useInAppUpdates();

	if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

	return (
		<AIConsentPresenter><Tabs
			initialRouteName="today"
			tabBar={(props) => <SolidTabBar {...props} />}
			// Back returns to the previously focused screen instead of always
			// falling out to the first tab (chat).
			backBehavior="history"
			screenOptions={{
				headerShown: false,
				sceneStyle: { backgroundColor: colors.bg },
			}}
		>
			<Tabs.Screen name="today" />
			<Tabs.Screen name="bible" />
			<Tabs.Screen name="index" />
			<Tabs.Screen name="connections" />
			<Tabs.Screen name="study" />
			{/* Legacy Notes URLs hand off to Study without appearing as a sixth tab. */}
			<Tabs.Screen name="notes" options={{ href: null, popToTopOnBlur: true }} />
			{/* Push-only nested stack: reachable from the chat header gear, hidden from
			    the tab bar. Reset on blur so the gear always reopens on the hub rather
			    than on whichever category page was open when the user left. */}
			<Tabs.Screen name="settings" options={{ href: null, popToTopOnBlur: true }} />
			{/* Push-only screen: reachable from Settings → Manage memories. */}
			<Tabs.Screen name="memories" options={{ href: null }} />
		</Tabs>
		{/* After the consent sheet is answered, at most once per release. */}
		<WhatsNewPresenter />
		{/* Walk with me: a brand-new account lands in its welcome; the spotlight draws over every tab. */}
		<WelcomeLauncher />
		<SpotlightOverlay /></AIConsentPresenter>
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
			flexWrap: "wrap",
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.sm,
			gap: spacing.xs,
		},
		// Yoga measures each label's intrinsic width before wrapping whole targets.
		// A zero flex basis would split the row equally and truncate Connections.
		tabSlot: { flexBasis: "auto", flexGrow: 1, flexShrink: 0, minWidth: 48, maxWidth: "100%" },
		tabItem: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			gap: 3,
			minHeight: TAB_BAR_ITEM_HEIGHT,
			minWidth: 48,
			paddingHorizontal: spacing.xs,
			borderRadius: radius.lg,
		},
		chatIndicator: { position: "absolute", bottom: 0, left: "26%", right: "26%", height: 2, borderRadius: 2 },
		tabItemActive: {
			backgroundColor: c.accentSoft,
		},
		tabLabel: { color: c.textFaint, ...typography.micro, fontWeight: "400", textAlign: "center", flexShrink: 0 },
	});

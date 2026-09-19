import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { spacing } from "@/theme";
import { useSettings, useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { hydratePreferences, usePreferencesToggles } from "@/features/settings/preferencesSync";
import { prefetchSettingsData, useSettingsData } from "@/features/settings/settingsData";
import { useNotificationSettings } from "@/features/notifications/notificationSettings";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { checkForUpdate, type UpdateCheckResult } from "@/features/updates/inAppUpdates";
import {
	SettingsAvatar,
	SettingsGroup,
	SettingsRow,
	SettingsSubScreen,
	THEME_OPTIONS,
	formatHour,
} from "@/features/settings/SettingsChrome";

/** The profile card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * Every return from a category page refocuses the hub, and the store only
 * dedupes requests already in flight, so without a floor a walk through four
 * categories would refetch providers, church and memories five times over.
 * The pages that change those values write the store directly on success.
 */
const PREFETCH_MIN_INTERVAL_MS = 15_000;
let lastPrefetchAt = 0;

/**
 * Settings hub: one row per category, each pushing its own page. The rows show
 * the current value so the common question ("is memory on?") is answered here
 * rather than a tap away, which is also why the screen revalidates on focus.
 */
export default function SettingsScreen() {
	const router = useRouter();
	const { user } = useUser();
	const settings = useSettings();
	const notificationSettings = useNotificationSettings();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const getToken = useStableGetToken();

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";
	const version = Constants.expoConfig?.version ?? "";

	// Seeded from the account document the app already hydrated, so the row
	// subtitles paint their real values on the first frame instead of sitting
	// on an ellipsis until their own request lands.
	const preferences = usePreferencesToggles();
	// Providers, church and the memory count: prefetched at sign-in and
	// persisted, so every subtitle below is final on the first frame and
	// revalidates in place.
	const settingsData = useSettingsData();

	// Revalidated on focus so the subtitles stay fresh after returning from a
	// page. A failure leaves whatever was cached in place rather than breaking
	// the rest of Settings.
	useFocusEffect(
		useCallback(() => {
			// Opening Settings is also the retry for a hydrate that failed at
			// launch; without it the toggles would sit unknown for the rest of
			// the session. Throttled inside the sync module.
			void hydratePreferences();
			const now = Date.now();
			if (now - lastPrefetchAt >= PREFETCH_MIN_INTERVAL_MS) {
				lastPrefetchAt = now;
				void prefetchSettingsData(getToken);
			}
		}, [getToken])
	);

	const [updateState, setUpdateState] = useState<"idle" | "checking" | UpdateCheckResult>("idle");

	const runUpdateCheck = () => {
		if (updateState === "checking") return;
		setUpdateState("checking");
		void (async () => {
			// "started" hands the screen to Play's update flow; the other results
			// come straight back and are shown inline under the row.
			setUpdateState(await checkForUpdate());
		})();
	};

	const updateHint =
		updateState === "checking"
			? "Checking the Play Store…"
			: updateState === "up-to-date"
				? `You're on the latest version (${version}).`
				: updateState === "unavailable"
					? "Couldn't reach the Play Store. Try again in a moment."
					: updateState === "started"
						? "Update found - installing through the Play Store."
						: `Version ${version}. Updates also download automatically when the app opens.`;

	const themeLabel =
		THEME_OPTIONS.find((option) => option.id === settings.themeMode)?.label ?? settings.themeMode;
	const appearanceSubtitle = [
		themeLabel,
		settings.parchment ? "Parchment" : "Plain reader",
		settings.translation,
	].join(" · ");

	const church = settingsData.church.data;
	// The whole row disappears when the server has no Places key, matching the
	// section it replaces: there is nothing behind it to set.
	const churchAvailable = church?.status !== "unavailable";
	const churchSubtitle =
		church === null ? "…" : church.status === "ok" && church.church ? church.church.name : "Not set";

	const memoryEnabled = preferences.memoryEnabled ?? settingsData.memories.data?.enabled ?? null;
	const memoryCount = settingsData.memories.data?.count ?? null;
	const memorySubtitle =
		memoryEnabled === null
			? "…"
			: memoryEnabled
				? memoryCount === null
					? "On"
					: `On · ${memoryCount} saved`
				: "Off";

	const connectedKeys =
		settingsData.providers.data?.providers.filter((provider) => provider.connected).length ?? 0;
	const aiSubtitle =
		connectedKeys > 0
			? `Membership, provider keys, web search · ${connectedKeys} ${connectedKeys === 1 ? "key" : "keys"}`
			: "Membership, provider keys, web search";

	const checking = updateState === "checking";

	return (
		<SettingsSubScreen title="Settings" contentStyle={contentStyle}>
			<SettingsGroup>
				{/* No accessibilityLabel: the name and email compose the spoken label. */}
				<SettingsRow
					leading={
						<SettingsAvatar initial={(name || email || "✝").trim().charAt(0).toUpperCase()} />
					}
					title={name || "Signed in"}
					subtitle={email}
					onPress={() => router.push("/settings/account")}
				/>
			</SettingsGroup>

			{/* Directly under the profile because it is the row this app's owner
			    reaches for most often. */}
			<View style={styles.loneGroup}>
				<SettingsGroup>
					<SettingsRow
						icon="cloud-download-outline"
						title="Check for updates"
						subtitle={updateHint}
						disabled={checking}
						onPress={runUpdateCheck}
						trailing={checking ? <ActivityIndicator size="small" color={colors.accent} /> : undefined}
					/>
				</SettingsGroup>
			</View>

			<SettingsGroup label="STUDY">
				<SettingsRow
					icon="color-palette-outline"
					title="Appearance & reading"
					subtitle={appearanceSubtitle}
					onPress={() => router.push("/settings/appearance")}
				/>
				<SettingsRow
					icon="brush-outline"
					title="Highlight labels"
					subtitle="Names and meanings for your colours"
					onPress={() => router.push("/settings/highlights")}
				/>
				{churchAvailable ? (
					<SettingsRow
						icon="business-outline"
						title="My church"
						subtitle={churchSubtitle}
						onPress={() => router.push("/settings/church")}
					/>
				) : null}
			</SettingsGroup>

			<SettingsGroup label="ASSISTANT">
				<SettingsRow
					icon="sparkles-outline"
					title="Memory"
					subtitle={memorySubtitle}
					onPress={() => router.push("/settings/memory")}
				/>
				<SettingsRow
					icon="hardware-chip-outline"
					title="AI"
					subtitle={aiSubtitle}
					onPress={() => router.push("/settings/ai")}
				/>
				<SettingsRow
					icon="share-social-outline"
					title="Shared answers"
					subtitle="Links you have shared"
					onPress={() => router.push("/settings/shared")}
				/>
			</SettingsGroup>

			<SettingsGroup label="APP">
				<SettingsRow
					icon="notifications-outline"
					title="Notifications"
					subtitle={
						notificationSettings.enabled
							? `Daily verse ${formatHour(notificationSettings.hour)}`
							: "Daily verse off"
					}
					onPress={() => router.push("/settings/notifications")}
				/>
				<SettingsRow
					icon="chatbubble-ellipses-outline"
					title="Send feedback"
					subtitle="Tell us what is broken or missing"
					onPress={() => router.push("/settings/feedback")}
				/>
				<SettingsRow
					icon="information-circle-outline"
					title="About"
					subtitle={`Version ${version}`}
					onPress={() => router.push("/settings/about")}
				/>
			</SettingsGroup>
		</SettingsSubScreen>
	);
}

const createStyles = () =>
	StyleSheet.create({
		/**
		 * A labelled group is spaced by its own label's top margin. Two unlabelled
		 * cards in a row have nothing between them, so the second carries the gap.
		 */
		loneGroup: { marginTop: spacing.md },
	});

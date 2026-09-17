import React, { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useUser } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing } from "@/theme";
import {
	SettingsSubScreen,
	SettingsSwitchRow,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";
import { useTheme } from "@/features/settings/settingsStore";
import {
	hydratePreferences,
	noteMemoryEnabled,
	usePreferencesToggles,
} from "@/features/settings/preferencesSync";
import {
	noteMemoryEnabled as noteMemoryEnabledInData,
	refreshMemories,
	useSettingsData,
} from "@/features/settings/settingsData";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import * as memoriesApi from "@/features/memories/api";
import { AboutMeSection } from "@/features/settings/AboutMeSection";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * Settings -> Memory: the master switch, the way through to the saved
 * memories, and About me.
 */
export default function MemorySettingsScreen() {
	const router = useRouter();
	const { user } = useUser();
	const { colors } = useTheme();
	const styles = useSettingsStyles();
	const getToken = useStableGetToken();

	// Seeded from the account document the app already hydrated, so the switch
	// paints its real position on the first frame instead of sitting disabled
	// until its own request lands.
	const preferences = usePreferencesToggles();
	// The saved count comes from the settings-data store, prefetched at sign-in
	// and persisted, so the card is its final height on the first frame.
	const settingsData = useSettingsData();
	const [memoryEnabled, setMemoryEnabled] = useState<boolean | null>(null);
	const [memoryTogglePending, setMemoryTogglePending] = useState(false);
	const memoryValue =
		memoryEnabled ?? preferences.memoryEnabled ?? settingsData.memories.data?.enabled ?? null;
	const memoryCount = settingsData.memories.data?.count ?? null;

	// Revalidated on focus so the saved count stays fresh after returning from
	// the manage screen. Only the memory slice: this page reads nothing else,
	// and a failure leaves whatever was cached in place rather than breaking
	// the rest of the page.
	useFocusEffect(
		useCallback(() => {
			// Opening this page is also the retry for a hydrate that failed at
			// launch; without it the switch would sit disabled for the rest of
			// the session. Throttled inside the sync module.
			void hydratePreferences();
			refreshMemories(getToken).catch(() => {
				// The slice keeps its cached count and reports through `failed`.
			});
		}, [getToken])
	);

	const toggleMemory = (enabled: boolean) => {
		if (memoryTogglePending) return;
		setMemoryEnabled(enabled);
		setMemoryTogglePending(true);
		void (async () => {
			try {
				await memoriesApi.setMemoryEnabled(getToken, enabled);
				// Memory keeps its own endpoint; these only keep the shared
				// preferences and settings-data snapshots from disagreeing with it.
				noteMemoryEnabled(enabled);
				noteMemoryEnabledInData(enabled);
			} catch (err) {
				setMemoryEnabled(!enabled);
				Alert.alert(
					"Could not update memory",
					err instanceof Error && err.message ? err.message : "Your setting was not changed. Try again."
				);
			} finally {
				setMemoryTogglePending(false);
			}
		})();
	};

	return (
		<SettingsSubScreen title="Memory" contentStyle={contentStyle}>
			<GlassCard style={styles.card}>
				<SettingsSwitchRow
					title="Enable memory"
					accessibilityLabel="Enable memory"
					hint="When off, SureWord won't use or save memories. Your saved memories are kept."
					value={memoryValue}
					disabled={memoryTogglePending}
					onValueChange={toggleMemory}
				/>
				<Pressable
					accessibilityRole="button"
					onPress={() => router.push("/memories")}
					style={({ pressed }) => [
						styles.manageRow,
						pressed && { backgroundColor: colors.surfacePressed },
					]}
				>
					<View style={styles.manageText}>
						<Text style={styles.rowTitle}>Manage memories</Text>
						<Text style={styles.hint}>{memoryCount === null ? "…" : `${memoryCount} saved`}</Text>
					</View>
					<Text style={styles.chevron}>›</Text>
				</Pressable>
			</GlassCard>

			{/*
			 * Sits under Memory because it is the other half of what the
			 * assistant knows about this user: memory is what it noticed,
			 * About me is what they told it outright. Keyed so a new account
			 * never inherits the previous draft.
			 */}
			<AboutMeSection key={`about-${user?.id ?? "signed-out"}`} />
		</SettingsSubScreen>
	);
}

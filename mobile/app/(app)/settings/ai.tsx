import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { GlassCard } from "@/components/ui";
import {
	SectionLabel,
	SettingsSubScreen,
	SettingsSwitchRow,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";
import {
	hydratePreferences,
	updateWebSearchEnabled,
	usePreferencesToggles,
} from "@/features/settings/preferencesSync";
import { MembershipSection } from "@/features/settings/MembershipSection";
import { ProviderSettingsSection } from "@/features/settings/ProviderSettingsSection";
import { useStableGetToken } from "@/features/notes/useStableGetToken";

/**
 * Settings -> AI: what plan this account is on, the per-provider API keys that
 * unlock extra models, and whether the assistant may search the web.
 */
export default function AiSettingsScreen() {
	const styles = useSettingsStyles();
	const getToken = useStableGetToken();

	// Seeded from the account document the app already hydrated, so the switch
	// paints its real position on the first frame instead of sitting disabled
	// until its own request lands.
	const preferences = usePreferencesToggles();
	const [webSearchTogglePending, setWebSearchTogglePending] = useState(false);
	const webSearchValue = preferences.webSearchEnabled;

	useFocusEffect(
		useCallback(() => {
			// Opening this page is also the retry for a hydrate that failed at
			// launch; without it the web-search switch would sit disabled for
			// the rest of the session. Throttled inside the sync module.
			void hydratePreferences();
		}, [])
	);

	// Optimistic: the switch moves first and the sync module rolls it back if
	// the account write fails.
	const toggleWebSearch = (enabled: boolean) => {
		if (webSearchTogglePending) return;
		setWebSearchTogglePending(true);
		void (async () => {
			try {
				await updateWebSearchEnabled(enabled);
			} catch (err) {
				Alert.alert(
					"Could not update web search",
					err instanceof Error && err.message ? err.message : "Your setting was not changed. Try again."
				);
			} finally {
				setWebSearchTogglePending(false);
			}
		})();
	};

	return (
		<SettingsSubScreen title="AI">
			<SectionLabel label="MEMBERSHIP" />
			<MembershipSection getToken={getToken} />

			<SectionLabel label="API KEYS" />
			<ProviderSettingsSection getToken={getToken} />

			<SectionLabel label="WEB SEARCH" />
			<GlassCard style={styles.card}>
				<SettingsSwitchRow
					title="Enable web search"
					accessibilityLabel="Enable web search"
					hint="Lets SureWord look up supplementary material online (church history, archaeology, current events). Scripture stays the final authority."
					value={webSearchValue}
					disabled={webSearchTogglePending}
					onValueChange={toggleWebSearch}
				/>
			</GlassCard>
		</SettingsSubScreen>
	);
}

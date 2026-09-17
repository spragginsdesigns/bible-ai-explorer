import React from "react";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing } from "@/theme";
import { SettingsSubScreen, useSettingsStyles } from "@/features/settings/SettingsChrome";
import { useSettingsData } from "@/features/settings/settingsData";
import { ChurchSection } from "@/features/church/ChurchSection";
import { useStableGetToken } from "@/features/notes/useStableGetToken";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * Settings -> My church. The section renders nothing at all when the server
 * has no Places key, and the hub hides its row in that case, but a church
 * receipt can still deep-link here; say why the page is empty rather than
 * showing a bare title.
 */
export default function ChurchSettingsScreen() {
	const getToken = useStableGetToken();
	const styles = useSettingsStyles();
	const unavailable = useSettingsData().church.data?.status === "unavailable";
	return (
		<SettingsSubScreen title="My church" contentStyle={contentStyle}>
			{unavailable ? (
				<GlassCard style={styles.card}>
					<Text style={styles.hint}>
						Church search isn&apos;t available on this server right now.
					</Text>
				</GlassCard>
			) : (
				<ChurchSection getToken={getToken} hideHeading />
			)}
		</SettingsSubScreen>
	);
}

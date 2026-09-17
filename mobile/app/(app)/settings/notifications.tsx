import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	setChatRepliesEnabled,
	setVerseOfDayEnabled,
	setVerseOfDayHour,
	useNotificationSettings,
} from "@/features/notifications/notificationSettings";
import {
	SectionLabel,
	SettingsSubScreen,
	SettingsSwitchRow,
	formatHour,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";

/** Everything the app is allowed to interrupt the user with. */
export default function NotificationSettingsScreen() {
	const notificationSettings = useNotificationSettings();
	const { colors } = useTheme();
	const styles = useSettingsStyles();
	const local = useThemedStyles(createStyles);

	return (
		<SettingsSubScreen title="Notifications">
			<SectionLabel label="CHAT" />
			<GlassCard style={styles.card}>
				<SettingsSwitchRow
					title="Notify when an answer is ready"
					hint="Leave the app while SureWord is answering and it keeps working. This tells you when the answer has landed."
					value={notificationSettings.chatReplies}
					onValueChange={setChatRepliesEnabled}
					accessibilityLabel="Notify when an answer is ready"
				/>
			</GlassCard>

			<SectionLabel label="VERSE OF THE DAY" />
			<GlassCard style={styles.card}>
				<SettingsSwitchRow
					title="Daily verse notification"
					hint="An AI-picked verse each morning, shaped by what you've been reading and asking about."
					value={notificationSettings.enabled}
					onValueChange={setVerseOfDayEnabled}
					accessibilityLabel="Daily verse notification"
				/>
				{notificationSettings.enabled ? (
					<View style={styles.settingRow}>
						<Text style={styles.rowTitle}>Arrives at</Text>
						<View style={local.hourStepper}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="One hour earlier"
								onPress={() => setVerseOfDayHour((notificationSettings.hour + 23) % 24)}
								style={({ pressed }) => [
									local.hourButton,
									pressed && { backgroundColor: colors.surfacePressed },
								]}
							>
								<Text style={local.hourButtonLabel}>−</Text>
							</Pressable>
							<Text style={local.hourLabel}>{formatHour(notificationSettings.hour)}</Text>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="One hour later"
								onPress={() => setVerseOfDayHour((notificationSettings.hour + 1) % 24)}
								style={({ pressed }) => [
									local.hourButton,
									pressed && { backgroundColor: colors.surfacePressed },
								]}
							>
								<Text style={local.hourButtonLabel}>+</Text>
							</Pressable>
						</View>
					</View>
				) : null}
			</GlassCard>
		</SettingsSubScreen>
	);
}

/** The hour stepper is the one control the shared chrome has no shape for. */
const createStyles = (c: Colors) =>
	StyleSheet.create({
		hourStepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		hourButton: {
			width: 48,
			height: 48,
			borderRadius: radius.md,
			alignItems: "center",
			justifyContent: "center",
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		hourButtonLabel: { color: c.textSecondary, ...typography.body, fontWeight: "700" },
		hourLabel: {
			color: c.text,
			...typography.control,
			fontWeight: "600",
			minWidth: 72,
			textAlign: "center",
		},
	});

import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography, type Colors } from "@/theme";
import { setVoiceMode, useSettings, useTheme, useThemedStyles } from "@/features/settings/settingsStore";

/**
 * "Read it to me", shown only inside the welcome conversation. Off by
 * default; the choice is saved to the account, so it follows the reader to
 * another device and can be flipped at any point in the walk.
 */
export function WelcomeVoiceBar() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { voiceMode } = useSettings();
	return (
		<Pressable
			accessibilityRole="switch"
			accessibilityState={{ checked: voiceMode }}
			accessibilityLabel="Read it to me"
			onPress={() => setVoiceMode(!voiceMode)}
			style={styles.bar}
		>
			<Ionicons name={voiceMode ? "volume-high-outline" : "volume-mute-outline"} size={20} color={colors.accent} />
			<View style={styles.copy}>
				<Text style={styles.title}>Read it to me</Text>
				<Text style={styles.meta}>{voiceMode ? "SureWord reads each message aloud." : "Off. Turn on to hear each message."}</Text>
			</View>
			<Switch
				value={voiceMode}
				onValueChange={setVoiceMode}
				trackColor={{ true: colors.accent, false: colors.border }}
				importantForAccessibility="no"
			/>
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		bar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			minHeight: 56,
			marginHorizontal: spacing.lg,
			marginBottom: spacing.sm,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		copy: { flex: 1 },
		title: { ...typography.control, color: c.text, fontWeight: "700" },
		meta: { ...typography.meta, color: c.textSecondary },
	});

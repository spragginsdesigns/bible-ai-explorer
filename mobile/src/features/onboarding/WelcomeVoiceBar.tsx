import React from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography, type Colors } from "@/theme";
import { setVoiceMode, useSettings, useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import {
	dismissWelcomeVoiceBar,
	useWelcomeConversationId,
	useWelcomeVoiceBarDismissed,
} from "@/features/onboarding/onboardingStore";

/**
 * "Read it to me", shown only inside the welcome conversation. Off by
 * default; the choice is saved to the account, so it follows the reader to
 * another device and can be flipped at any point in the walk.
 *
 * The X closes it for good on this welcome (Austin, 2026-11-06: it sat on
 * top of the chat with no way to get rid of it). Closing also turns reading
 * off, so nothing keeps talking once its switch is gone. Starting the walk
 * again from Settings is a new welcome and shows the bar again.
 */
export function WelcomeVoiceBar() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const { voiceMode } = useSettings();
	const { userId } = useAuth();
	const welcomeId = useWelcomeConversationId(userId);
	const dismissed = useWelcomeVoiceBarDismissed(userId, welcomeId);
	if (dismissed) return null;
	const close = () => {
		if (!userId || !welcomeId) return;
		if (voiceMode) setVoiceMode(false);
		dismissWelcomeVoiceBar(userId, welcomeId);
	};
	return (
		<View style={styles.bar}>
			<Pressable
				accessibilityRole="switch"
				accessibilityState={{ checked: voiceMode }}
				accessibilityLabel="Read it to me"
				onPress={() => setVoiceMode(!voiceMode)}
				style={styles.toggle}
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
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Close Read it to me"
				onPress={close}
				hitSlop={8}
				style={styles.close}
			>
				<Ionicons name="close" size={20} color={colors.textSecondary} />
			</Pressable>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		bar: {
			flexDirection: "row",
			alignItems: "center",
			minHeight: 56,
			marginHorizontal: spacing.lg,
			marginBottom: spacing.sm,
			paddingLeft: spacing.lg,
			paddingRight: spacing.xs,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		toggle: {
			flex: 1,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: spacing.sm,
		},
		close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
		copy: { flex: 1 },
		title: { ...typography.control, color: c.text, fontWeight: "700" },
		meta: { ...typography.meta, color: c.textSecondary },
	});

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { HELP_SHEETS, type HelpScreen } from "@/features/onboarding/onboardingRules";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";

/**
 * What a "?" opens: a few plain lines about the screen, read right away with
 * nothing sent. "Ask SureWord about this" is the way into a chat, and it sends
 * the screen's fixed help sentence, which the server recognises as app help.
 */
export function HelpSheet({ screen, visible, onClose, onAsk }: {
	screen: HelpScreen; visible: boolean; onClose: () => void; onAsk: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const sheet = HELP_SHEETS[screen];
	return (
		<BottomSheet visible={visible} onClose={onClose} title={sheet.title} scroll>
			<View style={styles.body}>
				{sheet.points.map((point) => (
					<View key={point} style={styles.row}>
						<Ionicons name="checkmark-circle-outline" size={20} color={colors.accent} style={styles.icon} />
						<Text style={styles.point}>{point}</Text>
					</View>
				))}
				<Pressable accessibilityRole="button" onPress={onAsk}
					style={({ pressed }) => [styles.ask, pressed && styles.pressed]}>
					<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
					<Text style={styles.askLabel}>Ask SureWord about this</Text>
				</Pressable>
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
		row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
		icon: { marginTop: 2 },
		point: { flex: 1, color: c.text, ...typography.body },
		ask: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			minHeight: 48,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			marginTop: spacing.sm,
		},
		pressed: { opacity: 0.75 },
		askLabel: { color: c.accent, ...typography.control, fontFamily: fonts.bodyBold },
	});

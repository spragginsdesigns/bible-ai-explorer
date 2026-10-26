import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import type { ShowMeView } from "@/lib/chatView";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useOnboardingChat } from "./OnboardingChatContext";

/** SureWord's showInApp card: one sentence and a "Show me" that lights the place up. */
export function ShowMeCard({ card }: { card: ShowMeView }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const actions = useOnboardingChat();
	const tour = card.target === "tour";
	return (
		<View style={styles.card}>
			<Text style={styles.caption}>{card.caption}</Text>
			{actions ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => actions.showMe(card)}
					style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
				>
					<Ionicons name={tour ? "compass-outline" : "eye-outline"} size={18} color={colors.bg} />
					<Text style={styles.buttonText}>{tour ? "Show me around" : "Show me"}</Text>
				</Pressable>
			) : null}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			gap: spacing.md,
			marginTop: spacing.md,
			padding: spacing.lg,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		caption: { ...typography.body, color: c.text },
		button: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			minHeight: 56,
			borderRadius: radius.md,
			backgroundColor: c.accent,
		},
		buttonText: { ...typography.control, color: c.bg, fontWeight: "700" },
	});

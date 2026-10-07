import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";
import { SHARE_ACTIONS, type ShareAction } from "./shareIntake";

interface ShareActionsProps {
	/** Why parts of the share were not attached. */
	notices: string[];
	/** False until there is something to act on (text, or an attached file). */
	actionable: boolean;
	disabled: boolean;
	onAction: (action: ShareAction) => void;
	onDismiss: () => void;
}

const ACTION_ICONS: Record<ShareAction, React.ComponentProps<typeof Ionicons>["name"]> = {
	check: "shield-checkmark-outline",
	reply: "chatbubble-outline",
};

/** The two one-tap answers to a share, shown above the composer of the new chat. */
export function ShareActions({ notices, actionable, disabled, onAction, onDismiss }: ShareActionsProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	return (
		<View style={styles.wrap}>
			{notices.map((notice) => (
				<Text key={notice} style={styles.notice}>{notice}</Text>
			))}
			<View style={styles.row}>
				{actionable &&
					SHARE_ACTIONS.map(({ action, label }) => (
						<Pressable
							key={action}
							accessibilityRole="button"
							accessibilityLabel={label}
							accessibilityState={{ disabled }}
							disabled={disabled}
							onPress={() => onAction(action)}
							style={({ pressed }) => [
								styles.action,
								pressed && { backgroundColor: colors.accentPressed },
								disabled && styles.disabled,
							]}
						>
							<Ionicons name={ACTION_ICONS[action]} size={15} color={colors.accent} />
							<Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
						</Pressable>
					))}
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Dismiss share actions"
					onPress={onDismiss}
					hitSlop={8}
					style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.6 }]}
				>
					<Text style={styles.dismissGlyph}>×</Text>
				</Pressable>
			</View>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		wrap: { gap: spacing.xs, marginBottom: spacing.sm },
		notice: { ...typography.support, color: c.textMuted },
		row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
		action: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.xs,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderRadius: radius.full,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		actionLabel: { ...typography.meta, color: c.accent, fontWeight: "600" },
		disabled: { opacity: 0.4 },
		dismiss: { marginLeft: "auto", paddingHorizontal: spacing.xs },
		dismissGlyph: { color: c.textMuted, fontSize: 17, lineHeight: 19 },
	});

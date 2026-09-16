import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { spacing, radius, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { DailyCrossDirection } from "@/features/notifications/api";

/**
 * The two quiet ways to steer tomorrow's word without waiting for tomorrow:
 * keep today's theme and go further into it, or leave it for a different area
 * of life. Both run the ordinary replacement, so the busy panel, the scroll
 * back to the verse and the inline error card are the ones already on screen.
 *
 * "Stay with this" is only offered when the loaded day actually names a theme -
 * the server rejects `stay` with 409 otherwise, and a control that can only
 * fail is worse than no control. `themeKey` is read leniently for the same
 * reason: an older server sends none, and only the fresh side renders.
 *
 * Mirrors src/components/cross/DirectionControls.tsx on web.
 */
export function DirectionControls({
	themeKey,
	onDirection,
}: {
	themeKey?: string | null;
	onDirection: (direction: DailyCrossDirection) => void;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const canStay = typeof themeKey === "string" && themeKey.trim().length > 0;

	return (
		<View style={styles.row}>
			{canStay ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Stay with this theme and go further into it"
					onPress={() => onDirection("stay")}
					style={({ pressed }) => [
						styles.control,
						pressed && { backgroundColor: colors.surfacePressed },
					]}
				>
					<Text style={styles.label}>Stay with this</Text>
				</Pressable>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Take me somewhere fresh"
				onPress={() => onDirection("fresh")}
				style={({ pressed }) => [
					styles.control,
					pressed && { backgroundColor: colors.surfacePressed },
				]}
			>
				<Text style={styles.label}>Take me somewhere fresh</Text>
			</Pressable>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		row: {
			marginTop: spacing.sm,
			flexDirection: "row",
			flexWrap: "wrap",
			gap: spacing.sm,
		},
		control: {
			flexGrow: 1,
			flexBasis: 140,
			minHeight: 44,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.md,
		},
		label: {
			color: c.textFaint,
			...typography.control,
			fontWeight: "600",
			textAlign: "center",
		},
	});

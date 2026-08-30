import React, { useCallback, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

interface CollapsibleProps {
	/** Leading glyph, e.g. "📖". */
	glyph: string;
	title: string;
	/** Optional pill rendered next to the title. */
	badge?: { label: string; color: string };
	children: React.ReactNode;
}

/** Glass disclosure card used for retrieved verses and web sources. */
export function Collapsible({ glyph, title, badge, children }: CollapsibleProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [open, setOpen] = useState(false);
	const spin = useRef(new Animated.Value(0)).current;

	const toggle = useCallback(() => {
		const next = !open;
		setOpen(next);
		Animated.timing(spin, {
			toValue: next ? 1 : 0,
			duration: 180,
			easing: Easing.out(Easing.cubic),
			useNativeDriver: true,
		}).start();
	}, [open, spin]);

	const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });

	return (
		<View style={styles.card}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={toggle}
				style={({ pressed }) => [styles.header, pressed && { backgroundColor: colors.surfacePressed }]}
			>
				<Text style={styles.glyph}>{glyph}</Text>
				<Text style={styles.title} numberOfLines={1}>
					{title}
				</Text>
				{badge && (
					<View style={[styles.badge, { borderColor: badge.color }]}>
						<Text style={[styles.badgeLabel, { color: badge.color }]}>{badge.label}</Text>
					</View>
				)}
				<Animated.Text style={[styles.chevron, { transform: [{ rotate }] }]}>⌄</Animated.Text>
			</Pressable>
			{open && <View style={styles.body}>{children}</View>}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			marginTop: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
			overflow: "hidden",
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
		},
		glyph: { fontSize: 13 },
		title: { flexShrink: 1, color: c.textSecondary, fontSize: 13, fontWeight: "600" },
		badge: {
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.full,
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
		},
		badgeLabel: { ...typography.micro, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
		chevron: {
			marginLeft: "auto",
			color: c.textFaint,
			fontSize: 16,
			lineHeight: 18,
		},
		body: {
			borderTopColor: c.border,
			borderTopWidth: StyleSheet.hairlineWidth,
			paddingHorizontal: spacing.md,
			paddingBottom: spacing.sm,
		},
	});

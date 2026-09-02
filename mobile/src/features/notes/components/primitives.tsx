import React from "react";
import {
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
	type StyleProp,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

export type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Round icon button. Vector icon (Ionicons) inside a circular pressable -
 * emoji glyphs are gone: Android draws them in its color emoji font, which
 * can't be tinted and clashes with the theme.
 */
export function GlyphButton({
	icon,
	onPress,
	accessibilityLabel,
	active = false,
	danger = false,
	disabled = false,
	size = 38,
	style,
}: {
	icon: IoniconName;
	onPress: () => void;
	accessibilityLabel: string;
	active?: boolean;
	danger?: boolean;
	disabled?: boolean;
	size?: number;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const color = danger ? colors.danger : active ? colors.accent : colors.textMuted;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ selected: active, disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={6}
			style={({ pressed }) => [
				styles.glyphButton,
				{ width: size, height: size, borderRadius: size / 2 },
				active && styles.glyphButtonActive,
				pressed && !disabled && styles.glyphButtonPressed,
				disabled && { opacity: 0.35 },
				style,
			]}
		>
			<Ionicons name={icon} size={Math.round(size * 0.48)} color={color} />
		</Pressable>
	);
}

/** Pill used for folder/tag filters and tag toggles. */
export function Chip({
	label,
	active,
	onPress,
	dotColor,
	style,
	labelStyle,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
	dotColor?: string;
	style?: StyleProp<ViewStyle>;
	labelStyle?: StyleProp<TextStyle>;
}) {
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={({ pressed }) => [
				styles.chip,
				active && styles.chipActive,
				pressed && !active && styles.chipPressed,
				style,
			]}
		>
			{dotColor ? <View style={[styles.chipDot, { backgroundColor: dotColor }]} /> : null}
			<Text
				numberOfLines={1}
				style={[styles.chipLabel, active && styles.chipLabelActive, labelStyle]}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/** Dark glass sheet that slides up from the bottom of the screen. */
export function BottomSheet({
	visible,
	onClose,
	title,
	children,
	heightRatio,
	scroll = false,
}: {
	visible: boolean;
	onClose: () => void;
	title?: string;
	children: React.ReactNode;
	/** Fraction of screen height; omit to size to content. */
	heightRatio?: number;
	/**
	 * Size to content but never past the screen, and scroll the body when it
	 * overflows. The grabber and title stay pinned. For sheets whose content
	 * grows at runtime (the verse sheet streams an explanation and then loads
	 * the original-language words); sheets that host their own list keep the
	 * default and size with `heightRatio`.
	 */
	scroll?: boolean;
}) {
	const insets = useSafeAreaInsets();
	const styles = useThemedStyles(createStyles);
	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			statusBarTranslucent
			onRequestClose={onClose}
		>
			<Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
			<View
				style={[
					styles.sheet,
					heightRatio ? { height: `${Math.round(heightRatio * 100)}%` } : undefined,
					scroll ? styles.sheetScrollBound : undefined,
					{ paddingBottom: Math.max(insets.bottom, spacing.md) },
				]}
			>
				<View style={styles.grabber} />
				{title ? (
					<View style={styles.sheetHeader}>
						<Text style={styles.sheetTitle}>{title}</Text>
						<GlyphButton icon="close" accessibilityLabel="Close" onPress={onClose} size={32} />
					</View>
				) : null}
				{scroll ? (
					<ScrollView
						style={styles.sheetScroll}
						keyboardShouldPersistTaps="handled"
						showsVerticalScrollIndicator
					>
						{children}
					</ScrollView>
				) : (
					children
				)}
			</View>
		</Modal>
	);
}

/** Full-width row inside a BottomSheet. */
export function SheetRow({
	label,
	icon,
	onPress,
	danger = false,
	selected = false,
}: {
	label: string;
	icon?: IoniconName;
	onPress: () => void;
	danger?: boolean;
	selected?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
		>
			{icon ? (
				<View style={styles.sheetRowIcon}>
					<Ionicons name={icon} size={17} color={danger ? colors.danger : colors.textMuted} />
				</View>
			) : null}
			<Text style={[styles.sheetRowLabel, danger && { color: colors.danger }]} numberOfLines={1}>
				{label}
			</Text>
			{selected ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		glyphButton: {
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
		},
		glyphButtonActive: {
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
		},
		glyphButtonPressed: { backgroundColor: c.surfacePressed },
		glyph: { color: c.textMuted },

		chip: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingHorizontal: spacing.md,
			paddingVertical: 7,
			borderRadius: radius.full,
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
		},
		chipActive: { backgroundColor: c.accentSoft, borderColor: c.accentBorder },
		chipPressed: { backgroundColor: c.surfacePressed },
		chipDot: { width: 7, height: 7, borderRadius: 4 },
		chipLabel: { ...typography.meta, color: c.textMuted, fontWeight: "500", maxWidth: 150 },
		chipLabelActive: { color: c.accent },

		backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)" },
		sheet: {
			backgroundColor: c.bgElevated,
			borderTopLeftRadius: radius.xl,
			borderTopRightRadius: radius.xl,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.sm,
		},
		// Leaves a sliver of the page visible above a full sheet so it still
		// reads as a sheet, and gives the body ScrollView a bound to shrink to.
		sheetScrollBound: { maxHeight: "88%" },
		sheetScroll: { flexGrow: 0, flexShrink: 1 },
		grabber: {
			alignSelf: "center",
			width: 38,
			height: 4,
			borderRadius: 2,
			backgroundColor: c.surfacePressed,
			marginBottom: spacing.md,
		},
		sheetHeader: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			marginBottom: spacing.sm,
		},
		sheetTitle: { color: c.text, fontSize: 15, fontWeight: "600" },

		sheetRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingVertical: 14,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		sheetRowPressed: { backgroundColor: c.surfacePressed },
		sheetRowIcon: { width: 20, alignItems: "center" },
		sheetRowLabel: { color: c.textSecondary, fontSize: 15, flex: 1 },
	});

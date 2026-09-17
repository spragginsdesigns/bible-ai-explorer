import React from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	View,
	type StyleProp,
	type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { GlassCard, Screen } from "@/components/ui";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles, type ThemeMode } from "@/features/settings/settingsStore";

/**
 * The chrome every Settings screen shares: the hub (`app/(app)/settings/index`)
 * and each category page it pushes. One place for the top bar, the section
 * label, the option chip, the switch row and the hub row, so the pages read as
 * one screen split across a stack rather than ten screens that drifted apart.
 *
 * Styles are exposed through `useSettingsStyles` for the few places a page
 * needs the raw pieces (a custom row beside a stepper, the account card).
 */

export type SettingsIcon = React.ComponentProps<typeof Ionicons>["name"];

/**
 * The theme chips, shared by the Appearance page and the hub row that
 * summarises the current pick, so the summary can never name a theme
 * differently from the chip the user tapped.
 */
export const THEME_OPTIONS: { id: ThemeMode; label: string; glyph: string }[] = [
	{ id: "system", label: "System", glyph: "◐" },
	{ id: "dark", label: "Dark", glyph: "☾" },
	{ id: "light", label: "Light", glyph: "☀" },
];

/** 0-23 -> "8:00 AM" / "9:00 PM". */
export function formatHour(hour: number): string {
	const h12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

export function useSettingsStyles() {
	return useThemedStyles(createStyles);
}

/**
 * Back chevron, centred title, and a spacer that balances the button so the
 * title stays optically centred. The spacer must not paint the button's fill,
 * or it reads as an empty disabled control sitting in the corner.
 */
export function SettingsTopBar({ title }: { title: string }) {
	const router = useRouter();
	const styles = useSettingsStyles();
	return (
		<View style={styles.topBar}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Back"
				onPress={() => router.back()}
				hitSlop={8}
				style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
			>
				<Text style={styles.backGlyph}>‹</Text>
			</Pressable>
			<Text style={styles.title} numberOfLines={1}>
				{title}
			</Text>
			<View style={styles.backButtonSpacer} />
		</View>
	);
}

/**
 * A whole Settings screen: mesh background, top bar, scrolling content with
 * the shared horizontal padding and room under the last card for the tab bar.
 */
export function SettingsSubScreen({
	title,
	children,
	contentStyle,
}: {
	title: string;
	children: React.ReactNode;
	contentStyle?: StyleProp<ViewStyle>;
}) {
	const styles = useSettingsStyles();
	return (
		<Screen>
			<SettingsTopBar title={title} />
			<ScrollView
				contentContainerStyle={[styles.content, contentStyle]}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
				// A card above the viewport can still change height after a cold
				// cache (the membership card grows when its status lands): keep the
				// first visible card where it is instead of pushing the rows under
				// the thumb.
				maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
			>
				{children}
			</ScrollView>
		</Screen>
	);
}

/** The 44pt initial disc the hub's profile row and the Account page share. */
export function SettingsAvatar({ initial }: { initial: string }) {
	const styles = useSettingsStyles();
	return (
		<View style={styles.avatar}>
			<Text style={styles.avatarGlyph}>{initial}</Text>
		</View>
	);
}

/** The small-caps label above a card: "APPEARANCE", "STUDY". */
export function SectionLabel({ label }: { label: string }) {
	const styles = useSettingsStyles();
	return <Text style={styles.sectionLabel}>{label}</Text>;
}

/** One of a row of mutually exclusive choices (theme, translation). */
export function OptionChip({
	label,
	glyph,
	selected,
	onPress,
}: {
	label: string;
	glyph?: string;
	selected: boolean;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	const styles = useSettingsStyles();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			onPress={onPress}
			style={({ pressed }) => [
				styles.chip,
				selected && styles.chipActive,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			{glyph ? (
				<Text style={[styles.chipGlyph, selected && { color: colors.accent }]}>{glyph}</Text>
			) : null}
			<Text style={[styles.chipLabel, selected && { color: colors.accent }]}>{label}</Text>
		</Pressable>
	);
}

/**
 * Title + switch on one line, with the explanatory hint underneath. `value`
 * null means "not known yet" (an account toggle whose hydrate has not landed):
 * the switch paints off and disabled rather than lying about the state.
 */
export function SettingsSwitchRow({
	title,
	hint,
	value,
	disabled = false,
	onValueChange,
	accessibilityLabel,
}: {
	title: string;
	hint?: string;
	value: boolean | null;
	disabled?: boolean;
	onValueChange: (next: boolean) => void;
	accessibilityLabel?: string;
}) {
	const { colors } = useTheme();
	const styles = useSettingsStyles();
	const on = value === true;
	return (
		<View style={styles.switchBlock}>
			<View style={styles.settingRow}>
				<Text style={styles.rowTitle}>{title}</Text>
				<Switch
					accessibilityLabel={accessibilityLabel ?? title}
					value={on}
					disabled={value === null || disabled}
					onValueChange={onValueChange}
					trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
					thumbColor={on ? colors.accent : colors.textFaint}
				/>
			</View>
			{hint ? <Text style={styles.hint}>{hint}</Text> : null}
		</View>
	);
}

/**
 * A hub row: tinted icon disc, title, one-line summary, chevron. Used inside
 * `SettingsGroup`, which draws the separators, and on its own for the
 * profile and "Check for updates" cards.
 */
export function SettingsRow({
	icon,
	title,
	subtitle,
	onPress,
	disabled = false,
	accessibilityLabel,
	leading,
	trailing,
}: {
	icon?: SettingsIcon;
	title: string;
	subtitle?: string;
	onPress: () => void;
	disabled?: boolean;
	accessibilityLabel?: string;
	/** Replaces the icon disc (the profile avatar). */
	leading?: React.ReactNode;
	/** Replaces the chevron (a spinner while a check runs). */
	trailing?: React.ReactNode;
}) {
	const { colors } = useTheme();
	const styles = useSettingsStyles();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.row,
				pressed && { backgroundColor: colors.surfacePressed },
			]}
		>
			{leading ??
				(icon ? (
					<View style={styles.rowIcon}>
						<Ionicons name={icon} size={18} color={colors.accent} />
					</View>
				) : null)}
			<View style={styles.rowText}>
				<Text style={styles.rowTitle} numberOfLines={1}>
					{title}
				</Text>
				{subtitle ? (
					<Text style={styles.rowSubtitle} numberOfLines={2}>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing ?? <Text style={styles.chevron}>›</Text>}
		</Pressable>
	);
}

/**
 * A labelled card of rows with hairline separators. Rows are laid edge to
 * edge inside the card (the card carries no padding of its own) so the
 * pressed fill runs the full width like a native list.
 */
export function SettingsGroup({
	label,
	children,
}: {
	label?: string;
	children: React.ReactNode;
}) {
	const styles = useSettingsStyles();
	const rows = React.Children.toArray(children).filter(Boolean);
	return (
		<View>
			{label ? <SectionLabel label={label} /> : null}
			<GlassCard style={styles.groupCard}>
				{rows.map((row, index) => (
					<React.Fragment key={index}>
						{index > 0 ? <View style={styles.separator} /> : null}
						{row}
					</React.Fragment>
				))}
			</GlassCard>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		topBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			// 8, not 12: this bar is built around a 38pt back button rather than
			// the bare title the other screens use, so the wider padding pushed
			// its title ~10px below every other screen's title baseline.
			paddingVertical: spacing.sm,
			// Content scrolls under this bar; without a rule it hard-clips.
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
		},
		backButton: {
			width: 38,
			height: 38,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
		},
		backButtonSpacer: { width: 38, height: 38 },
		backButtonPressed: { backgroundColor: c.surfacePressed },
		backGlyph: { color: c.textMuted, ...typography.screenTitle, marginTop: -2 },
		title: {
			flex: 1,
			color: c.text,
			...typography.screenTitle,
			fontWeight: "700",
			textAlign: "center",
		},
		content: {
			paddingHorizontal: spacing.lg,
			paddingBottom: 120,
		},
		sectionLabel: {
			color: c.textFaint,
			...typography.sectionTitle,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
		},
		/** A padded content card (a page's editor card). */
		card: { padding: spacing.lg, gap: spacing.md },
		/** A list card: rows draw their own padding and the separators. */
		groupCard: { overflow: "hidden" },
		separator: {
			height: StyleSheet.hairlineWidth,
			backgroundColor: c.border,
			marginLeft: spacing.lg + 36 + spacing.md,
		},
		chipRow: { flexDirection: "row", gap: spacing.sm },
		chip: {
			flex: 1,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			minHeight: 44,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		chipActive: {
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		chipGlyph: { color: c.textMuted, ...typography.micro },
		chipLabel: { color: c.textMuted, ...typography.meta, fontWeight: "700" },
		hint: { color: c.textFaint, ...typography.support },
		switchBlock: { gap: spacing.md },
		settingRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
		},
		rowTitle: { color: c.text, ...typography.control, fontWeight: "600" },
		rowSubtitle: { color: c.textFaint, ...typography.meta, marginTop: 1 },
		row: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			minHeight: 56,
		},
		rowIcon: {
			width: 36,
			height: 36,
			borderRadius: radius.md,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
		},
		rowText: { flex: 1, minWidth: 0 },
		chevron: { color: c.textFaint, ...typography.screenTitle, marginTop: -2 },
		avatar: {
			width: 44,
			height: 44,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		avatarGlyph: {
			color: c.accent,
			...typography.chat,
			fontWeight: "700",
			fontFamily: fonts.sans,
		},
		/** A tappable row inside a padded `card` (Manage memories, Check for updates on a page). */
		manageRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginHorizontal: -spacing.sm,
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.sm,
			borderRadius: radius.md,
		},
		manageText: { flex: 1, minWidth: 0, gap: 2 },
	});

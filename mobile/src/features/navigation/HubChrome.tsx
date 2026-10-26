import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { chatColors } from "@/features/chat/chatAppearance";
import { useTheme } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { SpotlightAnchor } from "@/features/onboarding/Spotlight";
import { HELP_SCREENS, type HelpScreen } from "@/features/onboarding/onboardingRules";

export function SettingsButton({ colors }: { colors?: Colors }) {
	const router = useRouter();
	const theme = useTheme();
	const c = colors ?? theme.colors;
	return <Pressable accessibilityRole="button" accessibilityLabel="Settings and Memories"
		onPress={() => router.push("/settings")} hitSlop={4}
		style={({ pressed }) => [styles.settings, { backgroundColor: c.surface, borderColor: c.borderStrong, opacity: pressed ? 0.65 : 1 }]}>
		<Ionicons name="settings-outline" size={23} color={c.textSecondary} />
	</Pressable>;
}

/** "?" on a screen's header: asks SureWord about that screen in Chat (Walk with me). */
export function HelpButton({ screen, colors }: { screen: HelpScreen; colors?: Colors }) {
	const router = useRouter();
	const theme = useTheme();
	const c = colors ?? theme.colors;
	return <Pressable accessibilityRole="button" accessibilityLabel="Ask SureWord about this screen"
		onPress={() => router.navigate({ pathname: "/", params: { prompt: HELP_SCREENS[screen], autoSend: "1", handoffId: String(Date.now()) } })}
		hitSlop={4}
		style={({ pressed }) => [styles.settings, { backgroundColor: c.surface, borderColor: c.borderStrong, opacity: pressed ? 0.65 : 1 }]}>
		<Ionicons name="help-outline" size={23} color={c.textSecondary} />
	</Pressable>;
}

export function HubHeader({ title, brand = false, help }: { title: string; brand?: boolean; help?: HelpScreen }) {
	const { colors: theme } = useTheme();
	const c = chatColors(theme);
	return <View style={styles.header}>
		<Text accessibilityRole="header" style={[{ flexShrink: 1 }, brand
			? { fontFamily: fonts.brand, fontSize: 34, lineHeight: 44, color: c.text }
			: { ...typography.screenTitle, fontWeight: "700", color: c.text }]}>{title}</Text>
		<View style={styles.actions}>
			{help ? <HelpButton screen={help} colors={c} /> : null}
			<SettingsButton colors={c} />
		</View>
	</View>;
}

export type HubIcon = React.ComponentProps<typeof Ionicons>["name"];

export function HubRow({ spotlight, ...props }: HubRowProps & { spotlight?: string }) {
	// A named row can be lit up by the Walk with me spotlight.
	return spotlight ? <SpotlightAnchor target={spotlight}><HubRowBody {...props} /></SpotlightAnchor> : <HubRowBody {...props} />;
}

interface HubRowProps {
	icon: HubIcon; title: string; subtitle: string; onPress: () => void; prominent?: boolean;
}

function HubRowBody({ icon, title, subtitle, onPress, prominent = false }: HubRowProps) {
	const { colors: theme } = useTheme();
	const c = chatColors(theme);
	return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`}
		onPress={onPress} style={({ pressed }) => [styles.row, {
			backgroundColor: pressed ? c.surfacePressed : prominent ? c.accentSoft : c.surface,
			borderColor: prominent ? c.accentBorder : c.borderStrong,
		}]}>
		<View style={[styles.icon, { backgroundColor: c.accentSoft }]}><Ionicons name={icon} size={24} color={c.accent} /></View>
		<View style={styles.copy}><Text style={{ ...typography.control, fontWeight: "700", color: c.text }}>{title}</Text>
			<Text style={{ ...typography.meta, color: c.textMuted }}>{subtitle}</Text></View>
		<Ionicons name="chevron-forward" size={18} color={c.textMuted} />
	</Pressable>;
}

const styles = StyleSheet.create({
	header: { paddingHorizontal: spacing.xl, paddingTop: 8, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
	actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
	settings: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full },
	row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, minHeight: 82, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
	icon: { width: 44, height: 44, borderRadius: radius.md, justifyContent: "center", alignItems: "center" },
	copy: { flex: 1, gap: 3 },
});

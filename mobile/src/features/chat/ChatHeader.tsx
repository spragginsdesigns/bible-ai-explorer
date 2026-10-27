import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppText as Text } from "@/components/AppText";
import { BrandTitle } from "@/components/ui";
import { SureWordGuideAvatar } from "@/components/SureWordGuideAvatar";
import type { GuidePhase } from "@/components/guideMotion";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { spacing, typography, type Colors } from "@/theme";
import { chatColors } from "./chatAppearance";

export function ChatHeader({ title, phase = "idle", onNewChat, onOpenModelPicker, onOpenHistory, onOpenSettings, onHelp }: {
	title?: string;
	phase?: GuidePhase;
	onNewChat: () => void;
	onOpenModelPicker: () => void;
	onOpenHistory: () => void;
	onOpenSettings: () => void;
	/** Ask SureWord how Chat works (Walk with me's per-screen help). */
	onHelp?: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const router = useRouter();
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const { colors: theme } = useTheme();
	const colors = chatColors(theme);
	const { width } = useWindowDimensions();
	const styles = useThemedStyles(createStyles);
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
	const choose = (action: () => void) => {
		setMenuOpen(false);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(action, 220);
	};
	const options = [
		{ label: "Text size", icon: "text-outline" as const, action: () => router.push("/settings/appearance") },
		{ label: "Choose AI model", icon: "sparkles-outline" as const, action: onOpenModelPicker },
		{ label: "Conversation history", icon: "time-outline" as const, action: onOpenHistory },
		{ label: "Settings and Memories", icon: "settings-outline" as const, action: onOpenSettings },
		...(onHelp ? [{ label: "Help with Chat", icon: "help-circle-outline" as const, action: onHelp }] : []),
	];
	return <>
		<View style={styles.header}>
			{width >= 400 ? <View style={styles.mark}>
				{phase === "idle" ? <Image accessible={false} source={require("../../../assets/chat-home/sureword-mark.png")} resizeMode="contain" style={[styles.markImage, { tintColor: colors.accent }]} /> : <SureWordGuideAvatar phase={phase} size={44} />}
			</View> : null}
			<View style={styles.title}>
				<BrandTitle size={27} style={{ color: colors.text }} />
				{title ? <Text style={styles.subtitle} numberOfLines={1}>{title}</Text> : null}
			</View>
			<Pressable accessibilityRole="button" accessibilityLabel="New chat" onPress={onNewChat} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
				<View style={styles.newChat}><Ionicons name="add" size={24} color={colors.accent} /></View>
			</Pressable>
			<Pressable accessibilityRole="button" accessibilityLabel="Chat options" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
				<Ionicons name="ellipsis-vertical" size={21} color={colors.textMuted} />
			</Pressable>
			<Pressable accessibilityRole="button" accessibilityLabel="Settings and Memories" onPress={onOpenSettings} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
				<Ionicons name="settings-outline" size={23} color={colors.textSecondary} />
			</Pressable>
		</View>
		<BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Chat options" scroll>
			{options.map(option => <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label} onPress={() => choose(option.action)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
				<Ionicons name={option.icon} size={22} color={colors.accent} />
				<Text style={styles.optionLabel}>{option.label}</Text>
				<Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
			</Pressable>)}
		</BottomSheet>
	</>;
}

const createStyles = (theme: Colors) => {
	const c = chatColors(theme);
	return StyleSheet.create({
		header: { minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm },
		mark: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
		markImage: { width: 58, height: 58 },
		title: { flex: 1, minWidth: 0 },
		subtitle: { ...typography.micro, color: c.textMuted },
		button: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
		newChat: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentDim },
		pressed: { backgroundColor: c.surfacePressed },
		option: { minHeight: 56, paddingHorizontal: spacing.sm, gap: spacing.md, flexDirection: "row", alignItems: "center" },
		optionLabel: { ...typography.body, color: c.text, flex: 1 },
	});
};

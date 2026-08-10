import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth, useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { GlassCard, Screen } from "@/components/ui";
import { fonts, radius, spacing, type Colors } from "@/theme";
import {
	setBibleTranslation,
	setThemeMode,
	useSettings,
	useThemedStyles,
	useTheme,
	type ThemeMode,
} from "@/features/settings/settingsStore";
import { TRANSLATIONS, type TranslationId } from "@/features/bible/translations";

const THEME_OPTIONS: { id: ThemeMode; label: string; glyph: string }[] = [
	{ id: "system", label: "System", glyph: "◐" },
	{ id: "dark", label: "Dark", glyph: "☾" },
	{ id: "light", label: "Light", glyph: "☀" },
];

function SectionLabel({ label }: { label: string }) {
	const styles = useThemedStyles(createStyles);
	return <Text style={styles.sectionLabel}>{label}</Text>;
}

function OptionChip({
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
	const styles = useThemedStyles(createStyles);
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
 * Settings: appearance (system/dark/light), default Bible translation for the
 * reader and chat attachments, and the account (profile + sign out, which the
 * web app has had via Clerk's UserButton). Push-only screen reached from the
 * chat header gear.
 */
export default function SettingsScreen() {
	const router = useRouter();
	const { signOut } = useAuth();
	const { user } = useUser();
	const settings = useSettings();
	const styles = useThemedStyles(createStyles);

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";
	const version = Constants.expoConfig?.version ?? "";

	const confirmSignOut = () => {
		Alert.alert("Sign out?", "You can sign back in at any time.", [
			{ text: "Cancel", style: "cancel" },
			{ text: "Sign out", style: "destructive", onPress: () => void signOut() },
		]);
	};

	return (
		<Screen>
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
				<Text style={styles.title}>Settings</Text>
				<View style={styles.backButton} />
			</View>

			<ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
				<SectionLabel label="APPEARANCE" />
				<GlassCard style={styles.card}>
					<View style={styles.chipRow}>
						{THEME_OPTIONS.map((option) => (
							<OptionChip
								key={option.id}
								label={option.label}
								glyph={option.glyph}
								selected={settings.themeMode === option.id}
								onPress={() => setThemeMode(option.id)}
							/>
						))}
					</View>
					<Text style={styles.hint}>
						System follows your phone&apos;s dark or light mode.
					</Text>
				</GlassCard>

				<SectionLabel label="BIBLE TRANSLATION" />
				<GlassCard style={styles.card}>
					<View style={styles.chipRow}>
						{(Object.keys(TRANSLATIONS) as TranslationId[]).map((id) => (
							<OptionChip
								key={id}
								label={id}
								selected={settings.translation === id}
								onPress={() => setBibleTranslation(id)}
							/>
						))}
					</View>
					<Text style={styles.hint}>
						Used by the Bible reader and verse attachments. KJV works fully offline; NKJV is
						streamed from bolls.life. VerseMind&apos;s AI answers always quote the KJV.
					</Text>
				</GlassCard>

				<SectionLabel label="ACCOUNT" />
				<GlassCard style={styles.card}>
					<View style={styles.accountRow}>
						<View style={styles.avatar}>
							<Text style={styles.avatarGlyph}>
								{(name || email || "✝").trim().charAt(0).toUpperCase()}
							</Text>
						</View>
						<View style={styles.accountText}>
							{name ? (
								<Text style={styles.accountName} numberOfLines={1}>
									{name}
								</Text>
							) : null}
							<Text style={styles.accountEmail} numberOfLines={1}>
								{email || "Signed in"}
							</Text>
						</View>
					</View>
					<Pressable
						accessibilityRole="button"
						onPress={confirmSignOut}
						style={({ pressed }) => [
							styles.signOutButton,
							pressed && { backgroundColor: "rgba(248, 113, 113, 0.18)" },
						]}
					>
						<Text style={styles.signOutLabel}>Sign out</Text>
					</Pressable>
				</GlassCard>

				<SectionLabel label="ABOUT" />
				<GlassCard style={styles.card}>
					<Text style={styles.aboutName}>VerseMind</Text>
					<Text style={styles.hint}>
						Version {version} · A Bible study assistant rooted in the King James Version.
					</Text>
				</GlassCard>
			</ScrollView>
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		topBar: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
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
		backButtonPressed: { backgroundColor: c.surfacePressed },
		backGlyph: { color: c.textMuted, fontSize: 22, marginTop: -2 },
		title: {
			flex: 1,
			color: c.text,
			fontSize: 17,
			fontWeight: "700",
			textAlign: "center",
		},
		content: {
			paddingHorizontal: spacing.lg,
			paddingBottom: 120,
		},
		sectionLabel: {
			color: c.textFaint,
			fontSize: 11,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
			marginLeft: spacing.xs,
		},
		card: { padding: spacing.lg, gap: spacing.md },
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
		chipGlyph: { color: c.textMuted, fontSize: 14 },
		chipLabel: { color: c.textMuted, fontSize: 13, fontWeight: "700" },
		hint: { color: c.textFaint, fontSize: 12, lineHeight: 17 },
		accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
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
			fontSize: 18,
			fontWeight: "700",
			fontFamily: fonts.sans,
		},
		accountText: { flex: 1, minWidth: 0 },
		accountName: { color: c.text, fontSize: 15, fontWeight: "600" },
		accountEmail: { color: c.textFaint, fontSize: 13, marginTop: 1 },
		signOutButton: {
			minHeight: 44,
			borderRadius: radius.lg,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
		},
		signOutLabel: { color: c.danger, fontSize: 14, fontWeight: "700" },
		aboutName: { color: c.text, fontSize: 15, fontWeight: "600" },
	});

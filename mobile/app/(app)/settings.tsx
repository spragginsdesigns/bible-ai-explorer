import React, { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useAuth, useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { GlassCard, Screen } from "@/components/ui";
import { fonts, radius, spacing, type Colors } from "@/theme";
import {
	setBibleTranslation,
	setParchmentEnabled,
	setThemeMode,
	useSettings,
	useThemedStyles,
	useTheme,
	type ThemeMode,
} from "@/features/settings/settingsStore";
import { TRANSLATIONS, type TranslationId } from "@/features/bible/translations";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import * as memoriesApi from "@/features/memories/api";
import { ChurchSection } from "@/features/church/ChurchSection";
import {
	setChatRepliesEnabled,
	setVerseOfDayEnabled,
	setVerseOfDayHour,
	useNotificationSettings,
} from "@/features/notifications/notificationSettings";
import { ProviderSettingsSection } from "@/features/settings/ProviderSettingsSection";
import { checkForUpdate, type UpdateCheckResult } from "@/features/updates/inAppUpdates";

const THEME_OPTIONS: { id: ThemeMode; label: string; glyph: string }[] = [
	{ id: "system", label: "System", glyph: "◐" },
	{ id: "dark", label: "Dark", glyph: "☾" },
	{ id: "light", label: "Light", glyph: "☀" },
];

/** 0-23 → "8:00 AM" / "9:00 PM". */
function formatHour(hour: number): string {
	const h12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

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
	const notificationSettings = useNotificationSettings();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const getToken = useStableGetToken();

	const email = user?.primaryEmailAddress?.emailAddress ?? "";
	const name = user?.fullName ?? user?.username ?? "";
	const version = Constants.expoConfig?.version ?? "";

	const [memoryEnabled, setMemoryEnabled] = useState<boolean | null>(null);
	const [memoryCount, setMemoryCount] = useState<number | null>(null);
	const [memoryTogglePending, setMemoryTogglePending] = useState(false);

	// Re-fetched on focus so the saved count stays fresh after returning from
	// the manage screen. A failure leaves the toggle disabled rather than
	// breaking the rest of Settings.
	useFocusEffect(
		useCallback(() => {
			let cancelled = false;
			void (async () => {
				try {
					const data = await memoriesApi.fetchMemories(getToken);
					if (cancelled) return;
					setMemoryEnabled(data.enabled);
					setMemoryCount(data.memories.length);
				} catch {
					if (cancelled) return;
					setMemoryEnabled(null);
					setMemoryCount(null);
				}
			})();
			return () => {
				cancelled = true;
			};
		}, [getToken])
	);

	const toggleMemory = (enabled: boolean) => {
		if (memoryTogglePending) return;
		setMemoryEnabled(enabled);
		setMemoryTogglePending(true);
		void (async () => {
			try {
				await memoriesApi.setMemoryEnabled(getToken, enabled);
			} catch (err) {
				setMemoryEnabled(!enabled);
				Alert.alert(
					"Could not update memory",
					err instanceof Error && err.message ? err.message : "Your setting was not changed. Try again."
				);
			} finally {
				setMemoryTogglePending(false);
			}
		})();
	};

	const [updateState, setUpdateState] = useState<"idle" | "checking" | UpdateCheckResult>("idle");

	const runUpdateCheck = () => {
		if (updateState === "checking") return;
		setUpdateState("checking");
		void (async () => {
			// "started" hands the screen to Play's update flow; the other results
			// come straight back and are shown inline under the row.
			setUpdateState(await checkForUpdate());
		})();
	};

	const updateHint =
		updateState === "checking"
			? "Checking the Play Store…"
			: updateState === "up-to-date"
				? `You're on the latest version (${version}).`
				: updateState === "unavailable"
					? "Couldn't reach the Play Store. Try again in a moment."
					: updateState === "started"
						? "Update found - installing through the Play Store."
						: `Version ${version}. Updates also download automatically when the app opens.`;

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
					<View style={styles.settingRow}>
						<Text style={styles.rowTitle}>Parchment reader</Text>
						<Switch
							accessibilityLabel="Parchment reader"
							value={settings.parchment}
							onValueChange={setParchmentEnabled}
							trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
							thumbColor={settings.parchment ? colors.accent : colors.textFaint}
						/>
					</View>
					<Text style={styles.hint}>
						Read the Bible on aged scroll paper. Off returns the plain reader.
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
						streamed from bolls.life. SureWord&apos;s AI answers always quote the KJV.
					</Text>
				</GlassCard>

				<SectionLabel label="MEMORY" />
				<GlassCard style={styles.card}>
					<View style={styles.settingRow}>
						<Text style={styles.rowTitle}>Enable memory</Text>
						<Switch
							accessibilityLabel="Enable memory"
							value={memoryEnabled ?? false}
							disabled={memoryEnabled === null || memoryTogglePending}
							onValueChange={toggleMemory}
							trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
							thumbColor={memoryEnabled ? colors.accent : colors.textFaint}
						/>
					</View>
					<Text style={styles.hint}>
						When off, SureWord won&apos;t use or save memories. Your saved memories are kept.
					</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => router.push("/memories")}
						style={({ pressed }) => [
							styles.manageRow,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<View style={styles.manageText}>
							<Text style={styles.rowTitle}>Manage memories</Text>
							<Text style={styles.hint}>
								{memoryCount === null ? "…" : `${memoryCount} saved`}
							</Text>
						</View>
						<Text style={styles.chevron}>›</Text>
					</Pressable>
				</GlassCard>

				{/*
				 * Renders its own "MY CHURCH" heading: the whole section, label
				 * included, disappears when the server has no Places key.
				 */}
				<ChurchSection getToken={getToken} />

				<SectionLabel label="CHAT" />
				<GlassCard style={styles.card}>
					<View style={styles.settingRow}>
						<Text style={styles.rowTitle}>Notify when an answer is ready</Text>
						<Switch
							accessibilityLabel="Notify when an answer is ready"
							value={notificationSettings.chatReplies}
							onValueChange={setChatRepliesEnabled}
							trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
							thumbColor={notificationSettings.chatReplies ? colors.accent : colors.textFaint}
						/>
					</View>
					<Text style={styles.hint}>
						Leave the app while SureWord is answering and it keeps working. This tells you
						when the answer has landed.
					</Text>
				</GlassCard>

				<SectionLabel label="VERSE OF THE DAY" />
				<GlassCard style={styles.card}>
					<View style={styles.settingRow}>
						<Text style={styles.rowTitle}>Daily verse notification</Text>
						<Switch
							accessibilityLabel="Daily verse notification"
							value={notificationSettings.enabled}
							onValueChange={setVerseOfDayEnabled}
							trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
							thumbColor={notificationSettings.enabled ? colors.accent : colors.textFaint}
						/>
					</View>
					<Text style={styles.hint}>
						An AI-picked verse each morning, shaped by what you&apos;ve been reading and
						asking about.
					</Text>
					{notificationSettings.enabled ? (
						<View style={styles.settingRow}>
							<Text style={styles.rowTitle}>Arrives at</Text>
							<View style={styles.hourStepper}>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="One hour earlier"
									onPress={() => setVerseOfDayHour((notificationSettings.hour + 23) % 24)}
									style={({ pressed }) => [
										styles.hourButton,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.hourButtonLabel}>−</Text>
								</Pressable>
								<Text style={styles.hourLabel}>{formatHour(notificationSettings.hour)}</Text>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="One hour later"
									onPress={() => setVerseOfDayHour((notificationSettings.hour + 1) % 24)}
									style={({ pressed }) => [
										styles.hourButton,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.hourButtonLabel}>+</Text>
								</Pressable>
							</View>
						</View>
					) : null}
				</GlassCard>

				<SectionLabel label="AI PROVIDERS" />
				<ProviderSettingsSection getToken={getToken} />

				<SectionLabel label="APP UPDATES" />
				<GlassCard style={styles.card}>
					<Pressable
						accessibilityRole="button"
						onPress={runUpdateCheck}
						disabled={updateState === "checking"}
						style={({ pressed }) => [
							styles.manageRow,
							pressed && { backgroundColor: colors.surfacePressed },
						]}
					>
						<View style={styles.manageText}>
							<Text style={styles.rowTitle}>Check for updates</Text>
							<Text style={styles.hint}>{updateHint}</Text>
						</View>
						<Text style={styles.chevron}>›</Text>
					</Pressable>
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
					<Text style={styles.aboutName}>SureWord</Text>
					<Text style={styles.hint}>
						Version {version} · A Bible study assistant rooted in the King James Version.
					</Text>
					<Text style={styles.hint}>
						Why it&apos;s different: ask a generic AI if the Bible is really the Word of God and
						you&apos;ll hear &ldquo;it depends on your viewpoint.&rdquo; SureWord never hedges — it
						answers as a Bible-believing Christian, standing on Scripture as the inerrant,
						infallible, final authority for every answer. &ldquo;All scripture is given by
						inspiration of God&rdquo; — 2 Timothy 3:16.
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
		settingRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
		},
		rowTitle: { color: c.text, fontSize: 15, fontWeight: "600" },
		hourStepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		hourButton: {
			width: 36,
			height: 36,
			borderRadius: radius.md,
			alignItems: "center",
			justifyContent: "center",
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		hourButtonLabel: { color: c.textSecondary, fontSize: 16, fontWeight: "700" },
		hourLabel: {
			color: c.text,
			fontSize: 15,
			fontWeight: "600",
			minWidth: 72,
			textAlign: "center",
		},
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
		chevron: { color: c.textFaint, fontSize: 22, marginTop: -2 },
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

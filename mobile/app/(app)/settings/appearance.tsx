import React from "react";
import { View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing } from "@/theme";
import {
	setBibleTranslation,
	setParchmentEnabled,
	setThemeMode,
	useSettings,
} from "@/features/settings/settingsStore";
import { TRANSLATIONS, type TranslationId } from "@/features/bible/translations";
import {
	OptionChip,
	SectionLabel,
	SettingsSubScreen,
	SettingsSwitchRow,
	THEME_OPTIONS,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * How the app looks and which translation the reader, verse attachments and
 * the assistant's answers quote from.
 */
export default function AppearanceSettingsScreen() {
	const settings = useSettings();
	const styles = useSettingsStyles();

	return (
		<SettingsSubScreen title="Appearance & reading" contentStyle={contentStyle}>
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
				<SettingsSwitchRow
					title="Parchment reader"
					hint="Read the Bible on aged scroll paper. Off returns the plain reader."
					value={settings.parchment}
					onValueChange={setParchmentEnabled}
					accessibilityLabel="Parchment reader"
				/>
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
					Used by the Bible reader and verse attachments. KJV and BSB work fully offline; NKJV is
					fetched when needed. SureWord&apos;s AI answers use the translation you select.
				</Text>
			</GlassCard>
		</SettingsSubScreen>
	);
}

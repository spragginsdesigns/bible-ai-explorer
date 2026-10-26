import React from "react";
import { View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing } from "@/theme";
import {
	setBibleTranslation,
	setParchmentEnabled,
	setQuizOffer,
	setTextScale,
	setThemeMode,
	useSettings,
} from "@/features/settings/settingsStore";
import { TEXT_SCALES, TEXT_SCALE_LABELS } from "@/features/settings/textScale";
import { SpotlightAnchor } from "@/features/onboarding/Spotlight";
import { TRANSLATIONS, translationPickerLabel, type TranslationId } from "@/features/bible/translations";
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
 * English translations share one row of short chips; a Bible in another
 * language gets a row of its own, since its label names the language too.
 */
const ALL_TRANSLATIONS = Object.keys(TRANSLATIONS) as TranslationId[];
const TRANSLATION_ROWS: TranslationId[][] = [
	ALL_TRANSLATIONS.filter((id) => TRANSLATIONS[id].language === "en"),
	...ALL_TRANSLATIONS.filter((id) => TRANSLATIONS[id].language !== "en").map((id) => [id]),
];

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
				<SettingsSwitchRow
					title="Offer a quiz after each chapter"
					hint="A short, optional quiz at the end of each chapter. Every answer comes with its verse."
					value={settings.quizOffer}
					onValueChange={setQuizOffer}
				/>
			</GlassCard>

			<SectionLabel label="TEXT SIZE" />
			<SpotlightAnchor target="settings.textSize">
				<GlassCard style={styles.card}>
					<View style={styles.chipRow}>
						{TEXT_SCALES.map((scale) => (
							<OptionChip
								key={scale}
								label={TEXT_SCALE_LABELS[scale]}
								selected={settings.textScale === scale}
								onPress={() => setTextScale(scale)}
							/>
						))}
					</View>
					<Text style={styles.hint}>
						Makes every word in SureWord bigger, on top of your phone&apos;s own text size. Saved to your
						account.
					</Text>
				</GlassCard>
			</SpotlightAnchor>

			<SectionLabel label="BIBLE TRANSLATION" />
			<GlassCard style={styles.card}>
				<View style={{ gap: spacing.sm }}>
					{TRANSLATION_ROWS.map((row) => (
						<View key={row.join(":")} style={styles.chipRow}>
							{row.map((id) => (
								<OptionChip
									key={id}
									label={translationPickerLabel(id)}
									selected={settings.translation === id}
									onPress={() => setBibleTranslation(id)}
								/>
							))}
						</View>
					))}
				</View>
				<Text style={styles.hint}>
					Used by the Bible reader and verse attachments. Every translation but NKJV works fully
					offline; NKJV is fetched when needed. SureWord&apos;s AI answers quote the translation you
					select when it is in the language they are written in (Settings, Language).
				</Text>
			</GlassCard>
		</SettingsSubScreen>
	);
}

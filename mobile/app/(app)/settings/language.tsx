import React from "react";
import { View } from "react-native";
import { useLocales } from "expo-localization";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing } from "@/theme";
import { chooseAnswerLanguage, useSettings } from "@/features/settings/settingsStore";
import { ANSWER_LANGUAGES, answerLanguageOptionLabel } from "@/features/settings/answerLanguage";
import {
	OptionChip,
	SectionLabel,
	SettingsSubScreen,
	useSettingsStyles,
} from "@/features/settings/SettingsChrome";

/**
 * The language SureWord answers in. "Follow my device" (the default) names
 * what the phone resolved to, so nobody has to guess. Picking a language also
 * opens that language's Bible when the current one is in another language;
 * menus stay in English for now.
 */
export default function LanguageSettingsScreen() {
	const settings = useSettings();
	const styles = useSettingsStyles();
	const deviceLanguage = useLocales()[0]?.languageCode;

	return (
		<SettingsSubScreen title="Language">
			<SectionLabel label="SUREWORD ANSWERS IN" />
			<GlassCard style={styles.card}>
				<View style={{ gap: spacing.sm }}>
					{ANSWER_LANGUAGES.map((choice) => (
						<View key={choice} style={styles.chipRow}>
							<OptionChip
								label={answerLanguageOptionLabel(choice, deviceLanguage)}
								selected={settings.answerLanguage === choice}
								onPress={() => chooseAnswerLanguage(choice)}
							/>
						</View>
					))}
				</View>
				<Text style={styles.hint}>
					Answers are written in this language and quote its Bible: the KJV in English, the
					Reina-Valera 1909 in Español, the Lutherbibel 1912 in Deutsch. Choosing a language also
					opens its Bible in the reader. Saved to your account.
				</Text>
			</GlassCard>
		</SettingsSubScreen>
	);
}

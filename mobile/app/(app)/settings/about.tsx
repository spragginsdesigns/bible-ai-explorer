import React from "react";
import { StyleSheet } from "react-native";
import Constants from "expo-constants";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { spacing, typography, type Colors } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { SettingsSubScreen, useSettingsStyles } from "@/features/settings/SettingsChrome";

/** The first card carries no label, so it needs the label's own top offset. */
const contentStyle = { paddingTop: spacing.xl };

/**
 * Held as one string so a reflow cannot split the sentence the product is
 * defined by. The two dashes are real em-dashes and several editors flatten
 * them to hyphens, so check them after touching this paragraph.
 */
const WHY_DIFFERENT =
	"Why it's different: ask a generic AI if the Bible is really the Word of God and " +
	"you'll hear “it depends on your viewpoint.” SureWord never hedges — it " +
	"answers as a Bible-believing Christian, standing on Scripture as the inerrant, " +
	"infallible, final authority for every answer. “All scripture is given by " +
	"inspiration of God” — 2 Timothy 3:16.";

/** What this app is and why it answers the way it does. */
export default function AboutSettingsScreen() {
	const styles = useSettingsStyles();
	const local = useThemedStyles(createStyles);
	const version = Constants.expoConfig?.version ?? "";

	return (
		<SettingsSubScreen title="About" contentStyle={contentStyle}>
			<GlassCard style={styles.card}>
				<Text style={local.aboutName}>SureWord</Text>
				<Text style={styles.hint}>
					{`Version ${version} · A Bible study assistant rooted in the King James Version.`}
				</Text>
				<Text style={styles.hint}>{WHY_DIFFERENT}</Text>
			</GlassCard>
		</SettingsSubScreen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		aboutName: { color: c.text, ...typography.control, fontWeight: "600" },
	});

import React from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@clerk/expo";
import { AppText as Text } from "@/components/AppText";
import { useSettingsSelector, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";
import { GoldButton, QuietButton } from "./QuizParts";
import { dismissQuizOffer, useQuizOfferDismissed } from "./quizDismissed";
import { KJV_NOTICE, OFFER_BODY, offerTitle, showsKjvNotice } from "./quizView";

/**
 * The end-of-chapter offer in the reader. Shown only to a signed-in reader
 * with "Offer a quiz after each chapter" on, and never again on this device
 * for a chapter they answered "Not now". It holds no state of its own, so a
 * chapter change in place re-reads both conditions for the new chapter.
 */
export function QuizOfferCard({
	book,
	chapter,
	bookName,
	textOnScreen,
	onStart,
}: {
	book: number;
	chapter: number;
	bookName: string;
	/** The label of the text the reader shows ("KJV", "NKJV", "BSB", the LC Greek). */
	textOnScreen: string;
	onStart: () => void;
}) {
	const { isSignedIn } = useAuth();
	const offer = useSettingsSelector((settings) => settings.quizOffer);
	const dismissed = useQuizOfferDismissed(book, chapter);
	const styles = useThemedStyles(createStyles);
	if (!isSignedIn || !offer || dismissed) return null;
	return (
		<View style={styles.card}>
			<Text accessibilityRole="header" style={styles.title}>
				{offerTitle(bookName, chapter)}
			</Text>
			<Text style={styles.body}>{OFFER_BODY}</Text>
			{showsKjvNotice(textOnScreen) ? <Text style={styles.notice}>{KJV_NOTICE}</Text> : null}
			<GoldButton label="Start quiz" accessibilityLabel={`Start quiz on ${bookName} ${chapter}`} onPress={onStart} style={styles.start} />
			<QuietButton label="Not now" onPress={() => dismissQuizOffer(book, chapter)} />
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			marginTop: spacing.xl,
			marginBottom: spacing.md,
			borderRadius: radius.xl,
			borderWidth: 1.5,
			borderColor: c.accent,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.xl,
			paddingTop: spacing.xl,
			paddingBottom: spacing.sm,
			alignItems: "stretch",
			gap: spacing.sm,
			shadowColor: c.accent,
			shadowOpacity: 0.25,
			shadowRadius: 16,
			shadowOffset: { width: 0, height: 0 },
			elevation: 4,
		},
		title: { color: c.text, ...typography.screenTitle, fontSize: 24, fontWeight: "700", textAlign: "center" },
		body: { color: c.textMuted, ...typography.body, textAlign: "center" },
		notice: { color: c.textFaint, ...typography.meta, textAlign: "center" },
		start: { marginTop: spacing.md },
	});

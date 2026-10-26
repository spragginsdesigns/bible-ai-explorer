import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { dismissGettingStarted, fetchGettingStarted, type GettingStartedProgress } from "./api";
import { GETTING_STARTED_ITEMS, TOUR_STOPS, type GettingStartedKey } from "./onboardingRules";
import { startSpotlight } from "./Spotlight";

/** The same captions web shows for each row. */
const CAPTIONS: Record<GettingStartedKey, string> = {
	readChapter: TOUR_STOPS.find((stop) => stop.target === "tab.bible")?.caption ?? "Here is the whole Bible.",
	tapVerse: TOUR_STOPS.find((stop) => stop.target === "reader.verse")?.caption ?? "Tap any verse and I will explain it to you.",
	dailyWord: "This is your Pick Up Your Cross: a verse and a short devotional made for you each day.",
	learnVerse: "Learn a verse helps you keep Scripture in your heart, one verse at a time.",
	church: "Add your home church here, and I will remember it.",
};

/**
 * Getting started, on Today, for accounts that came through Walk with me.
 * Each row ticks only when the server sees the real thing happen (a chapter
 * read, a verse explained), never on a tap here, and the card leaves for good
 * once everything is done or the reader dismisses it.
 */
export function GettingStartedCard() {
	const getToken = useStableGetToken();
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [progress, setProgress] = useState<GettingStartedProgress | null>(null);

	// Refetched whenever Today comes back into view, so a row ticked elsewhere shows at once.
	useFocusEffect(
		useCallback(() => {
			let live = true;
			fetchGettingStarted(getToken)
				.then((next) => live && setProgress(next))
				.catch(() => {
					// Offline or signed out: the card simply stays hidden.
				});
			return () => {
				live = false;
			};
		}, [getToken])
	);

	if (!progress?.show) return null;
	const done = GETTING_STARTED_ITEMS.filter((item) => progress.items[item.key]).length;

	return (
		<View style={styles.card}>
			<View style={styles.head}>
				<View style={styles.headCopy}>
					<Text accessibilityRole="header" style={styles.title}>Getting started</Text>
					<Text style={styles.meta}>{done} of {GETTING_STARTED_ITEMS.length} done</Text>
				</View>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Dismiss Getting started"
					hitSlop={8}
					onPress={() => {
						setProgress(null);
						void dismissGettingStarted(getToken).catch(() => {});
					}}
					style={styles.close}
				>
					<Ionicons name="close" size={20} color={colors.textMuted} />
				</Pressable>
			</View>
			{GETTING_STARTED_ITEMS.map((item) => {
				const ticked = progress.items[item.key];
				return (
					<Pressable
						key={item.key}
						accessibilityRole="button"
						accessibilityState={{ checked: ticked }}
						accessibilityLabel={`${item.label}${ticked ? ", done" : ""}`}
						// Lights the place straight away, like web and Apple; no AI turn is spent.
						onPress={() => startSpotlight([{ target: item.target, caption: CAPTIONS[item.key] }], "show")}
						style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
					>
						<Ionicons
							name={ticked ? "checkmark-circle" : "ellipse-outline"}
							size={24}
							color={ticked ? colors.accent : colors.textMuted}
						/>
						<Text style={[styles.label, ticked && styles.labelDone]}>{item.label}</Text>
						{ticked ? null : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
					</Pressable>
				);
			})}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			gap: spacing.xs,
			padding: spacing.lg,
			borderRadius: radius.lg,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		head: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
		headCopy: { flex: 1, gap: 2 },
		title: { ...typography.sectionTitle, color: c.text, fontWeight: "700" },
		meta: { ...typography.meta, color: c.textSecondary },
		close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
		row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52 },
		label: { ...typography.control, color: c.text, flex: 1 },
		labelDone: { color: c.textMuted, textDecorationLine: "line-through" },
	});

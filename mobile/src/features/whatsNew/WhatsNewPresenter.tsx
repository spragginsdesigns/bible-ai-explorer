import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { AppText as Text } from "@/components/AppText";
import { AccentButton, GhostButton } from "@/components/ui";
import { apiJson } from "@/lib/api";
import { aiConsentGate } from "@/lib/aiConsentGate";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { WHATS_NEW_ROUTES, type CatchUp } from "./whatsNew";

/**
 * "Since you were last here": once per release, after an update brought
 * something new, a sheet of up to three cards. It waits for the AI consent
 * sheet to be answered so the two never stack. The server only offers
 * releases up to this build's versionCode, so a phone that has not updated
 * yet is never told about a feature it cannot open. Any way of closing it
 * records the releases as seen on the account, on every device.
 */
export function WhatsNewPresenter() {
	const { userId, isLoaded } = useAuth();
	const router = useRouter();
	const getToken = useStableGetToken();
	const consent = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot);
	const consentSettled = (consent.record !== null || consent.declined) && !consent.prompt;
	const [catchUp, setCatchUp] = useState<CatchUp | null>(null);
	const checkedFor = useRef<string | null>(null);
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const installedCode = Constants.expoConfig?.android?.versionCode ?? null;

	useEffect(() => {
		if (!isLoaded || !userId || !consentSettled || checkedFor.current === userId) return;
		checkedFor.current = userId;
		let cancelled = false;
		const query = installedCode ? `?upTo=${installedCode}` : "";
		void apiJson<CatchUp>(getToken, `/api/whats-new/catch-up${query}`)
			.then((result) => {
				if (!cancelled && result.cards.length > 0) setCatchUp(result);
			})
			.catch(() => {
				// Offline or signed out mid-flight: nothing to show, try next launch.
				checkedFor.current = null;
			});
		return () => {
			cancelled = true;
		};
	}, [isLoaded, userId, consentSettled, getToken, installedCode]);

	const dismiss = (then?: Href) => {
		if (!catchUp) return;
		const seen = catchUp.seenUpTo;
		setCatchUp(null);
		void apiJson(getToken, "/api/whats-new/catch-up", { method: "POST", body: { versionCode: seen } }).catch(() => {
			// An unrecorded dismissal shows the sheet once more next launch; harmless.
		});
		if (then) router.push(then);
	};

	if (!catchUp) return null;
	const more = catchUp.newReleaseCount - catchUp.cards.length;

	return (
		<Modal visible transparent animationType="fade" onRequestClose={() => dismiss()}>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<View style={styles.header}>
						<Text accessibilityRole="header" style={styles.title}>
							Since you were last here
						</Text>
						<Text style={styles.badge}>
							{catchUp.newReleaseCount} {catchUp.newReleaseCount === 1 ? "update" : "updates"}
						</Text>
					</View>
					<ScrollView contentContainerStyle={styles.cards}>
						{catchUp.cards.map((card) => (
							<View key={card.versionCode} style={styles.card}>
								<View style={styles.versionRow}>
									<Ionicons name="sparkles" size={13} color={colors.accent} />
									<Text style={styles.version}>{card.version}</Text>
								</View>
								<Text style={styles.cardTitle}>{card.title}</Text>
								<Text style={styles.summary}>{card.summary}</Text>
								<AccentButton
									label={card.target ? "Try it" : "Read more"}
									accessibilityLabel={`${card.target ? "Try" : "Read more about"} ${card.title}`}
									onPress={() =>
										dismiss(
											card.target
												? WHATS_NEW_ROUTES[card.target]
												: { pathname: "/settings/whats-new", params: { version: card.version } }
										)
									}
								/>
							</View>
						))}
					</ScrollView>
					<Pressable
						accessibilityRole="link"
						onPress={() => dismiss("/settings/whats-new")}
						style={({ pressed }) => [styles.seeAll, pressed && { opacity: 0.7 }]}
					>
						<Text style={styles.seeAllLabel}>
							{more > 0 ? `See all release notes (${more} more)` : "See all release notes"}
						</Text>
						<Text style={styles.seeAllLabel}>›</Text>
					</Pressable>
					<GhostButton label="Got it" onPress={() => dismiss()} />
				</View>
			</View>
		</Modal>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		backdrop: { flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: "rgba(0,0,0,0.7)" },
		sheet: {
			maxHeight: "90%",
			backgroundColor: c.bgElevated,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.accentBorder,
			padding: spacing.xl,
			gap: spacing.md,
		},
		header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
		title: { flex: 1, color: c.text, fontFamily: fonts.verse, fontSize: 28, lineHeight: 32 },
		badge: {
			overflow: "hidden",
			backgroundColor: c.accent,
			color: c.bg,
			borderRadius: radius.full,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.xs,
			fontFamily: fonts.bodyBold,
			...typography.micro,
		},
		cards: { gap: spacing.md },
		card: {
			gap: spacing.sm,
			padding: spacing.lg,
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
		},
		versionRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
		version: { color: c.accent, fontFamily: fonts.bodyBold, ...typography.micro },
		cardTitle: { color: c.text, fontFamily: fonts.verse, fontSize: 21, lineHeight: 26 },
		summary: { color: c.textMuted, ...typography.support, marginBottom: spacing.xs },
		seeAll: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
		seeAllLabel: { color: c.accent, fontFamily: fonts.bodyBold, ...typography.support },
	});

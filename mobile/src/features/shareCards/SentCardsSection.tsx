import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { apiJson, type GetToken } from "@/lib/api";
import { radius, spacing, typography, type Colors } from "@/theme";

/**
 * Settings -> Shared answers -> CARDS YOU SENT (docs/FEATURES.md, "Share
 * cards" -> "Send a word"). Every personal card this account sent, with Copy
 * link and Revoke. Revoking makes the card's page and image answer 404 at
 * once; a picture already saved by whoever received it is out of reach.
 * Mirrors src/components/settings/SentCardsSection.tsx and the Apple list.
 */

interface SentCard {
	id: string;
	url: string;
	kind: "word" | "verse" | "reflection";
	reference: string;
	recipient: string | null;
	createdAt: string;
	revokedAt: string | null;
}

function cardTitle(card: SentCard): string {
	return card.recipient ? `For ${card.recipient} · ${card.reference}` : card.reference;
}

export function SentCardsSection({ getToken }: { getToken: GetToken }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useTheme();
	const [cards, setCards] = useState<SentCard[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setFailed(false);
		try {
			const data = await apiJson<{ cards?: SentCard[] }>(getToken, "/api/cards/personal");
			setCards(Array.isArray(data.cards) ? data.cards : []);
		} catch {
			setFailed(true);
		}
	}, [getToken]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (!copiedId) return;
		const timer = setTimeout(() => setCopiedId(null), 2000);
		return () => clearTimeout(timer);
	}, [copiedId]);

	const revoke = (card: SentCard) => {
		Alert.alert("Take this card back?", "Its link and picture stop working for everyone right away.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Revoke",
				style: "destructive",
				onPress: () => {
					setRevokingId(card.id);
					apiJson(getToken, `/api/cards/personal/${card.id}`, { method: "DELETE" })
						.then(() =>
							setCards((current) =>
								current?.map((row) => (row.id === card.id ? { ...row, revokedAt: new Date().toISOString() } : row)) ?? current
							)
						)
						.catch(() => Alert.alert("Couldn't revoke", "Check your connection and try again."))
						.finally(() => setRevokingId(null));
				},
			},
		]);
	};

	return (
		<>
			<Text style={styles.sectionLabel}>CARDS YOU SENT</Text>
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>Words you sent to someone. Revoke one to take its link and picture back.</Text>
				{cards === null ? (
					<View style={styles.stateRow}>
						<Text style={styles.hint}>{failed ? "Couldn't load your cards." : "Loading your cards…"}</Text>
						{failed ? (
							<Pressable accessibilityRole="button" onPress={() => void load()} style={styles.actionButton}>
								<Text style={styles.actionLabel}>Retry</Text>
							</Pressable>
						) : (
							<ActivityIndicator size="small" color={colors.accent} />
						)}
					</View>
				) : cards.length === 0 ? (
					<View style={styles.stateRow}>
						<Text style={styles.hint}>Cards you send appear here.</Text>
					</View>
				) : (
					cards.map((card) => {
						const revoked = Boolean(card.revokedAt);
						return (
							<View key={card.id} style={styles.row}>
								<Text style={styles.title} numberOfLines={2}>
									{cardTitle(card)}
								</Text>
								<Text style={styles.meta}>
									{revoked ? "Revoked" : copiedId === card.id ? "Link copied" : new Date(card.createdAt).toLocaleDateString()}
								</Text>
								{!revoked ? (
									<View style={styles.actions}>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="Copy this card's link"
											onPress={() =>
												Clipboard.setStringAsync(card.url)
													.then(() => setCopiedId(card.id))
													.catch(() => {})
											}
											style={({ pressed }) => [styles.actionButton, pressed && { backgroundColor: colors.surfacePressed }]}
										>
											<Text style={styles.actionLabel}>Copy link</Text>
										</Pressable>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="Revoke this card"
											disabled={revokingId !== null}
											onPress={() => revoke(card)}
											style={({ pressed }) => [
												styles.actionButton,
												revokingId !== null && styles.actionDisabled,
												pressed && { backgroundColor: colors.dangerSoft },
											]}
										>
											<Text style={[styles.actionLabel, styles.revokeLabel]}>Revoke</Text>
										</Pressable>
									</View>
								) : null}
							</View>
						);
					})
				)}
			</GlassCard>
		</>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		sectionLabel: {
			color: c.textFaint,
			...typography.sectionTitle,
			fontWeight: "700",
			letterSpacing: 1.2,
			marginTop: spacing.xl,
			marginBottom: spacing.sm,
		},
		card: { padding: spacing.lg, gap: spacing.md },
		hint: { flex: 1, color: c.textFaint, ...typography.support },
		stateRow: {
			minHeight: 56,
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			paddingHorizontal: spacing.md,
		},
		row: {
			gap: 4,
			padding: spacing.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
		},
		title: { color: c.text, ...typography.control },
		meta: { color: c.textFaint, ...typography.micro },
		actions: { flexDirection: "row", gap: spacing.sm },
		actionButton: { minHeight: 44, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
		actionLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		revokeLabel: { color: c.danger },
		actionDisabled: { opacity: 0.4 },
	});

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { AppText as Text } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { relativeTime } from "@/features/notes/utils";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";
import type { GetToken } from "@/lib/api";
import {
	listShares,
	revokeShare,
	setShareListed,
	type SharedAnswerSummary,
} from "./shareApi";

/**
 * Settings -> SHARED ANSWERS (docs/FEATURES.md, "Share an answer: a public
 * page, and a card image"). Every link this account has minted, with Revoke
 * and the opt-in "Show in search" switch (unlisted and noindex by default).
 *
 * Revoked rows stay in the list rather than disappearing. A link that was
 * public is a thing that happened, and the user is better served seeing that it
 * is now dead than seeing it vanish and wondering whether it ever existed.
 */

const DESCRIPTION =
	"Anyone holding one of these links can read that answer without signing in. Links are unlisted, so search engines don't show them, unless you turn on Show in search. Revoking takes a link back.";

const LIST_CONFIRM_TITLE = "Show this answer in search?";
const LIST_CONFIRM_MESSAGE =
	"Anyone will be able to find this question and answer on Google and other search engines. Your name is never shown. You can turn this off at any time.";

const EMPTY = "Answers you share appear here.";

/** A snapshot whose prompt was empty still needs something to point at. */
const UNTITLED = "An answer you shared";

/** How long "Copied" stays under the row before it goes back to the link. */
const COPIED_MS = 2000;

/** `hideHeading` is for the Settings page that already carries this title in its top bar. */
export function SharedAnswersSection({
	getToken,
	hideHeading = false,
}: {
	getToken: GetToken;
	hideHeading?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [shares, setShares] = useState<SharedAnswerSummary[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [loading, setLoading] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [listingId, setListingId] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const activeRef = useRef(true);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await listShares(getToken);
			if (!activeRef.current) return;
			setShares(data.shares);
			setFailed(false);
		} catch {
			if (!activeRef.current) return;
			// Only meaningful while nothing has loaded: a failed revalidation
			// leaves the list that is already on screen alone.
			setFailed(true);
		} finally {
			if (activeRef.current) setLoading(false);
		}
	}, [getToken]);

	useEffect(() => {
		void load();
	}, [load]);

	const copy = (share: SharedAnswerSummary) => {
		void (async () => {
			try {
				await Clipboard.setStringAsync(share.url);
			} catch {
				Alert.alert("Couldn't copy", "The link didn't reach your clipboard. Try again.");
				return;
			}
			if (!activeRef.current) return;
			setCopiedId(share.id);
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => {
				if (activeRef.current) setCopiedId(null);
			}, COPIED_MS);
		})();
	};

	/** Optimistic: the row reads "Revoked" on the tap, and goes back on failure. */
	const revoke = (share: SharedAnswerSummary) => {
		if (revokingId || listingId === share.id) return;
		const revokedAt = new Date().toISOString();
		setRevokingId(share.id);
		// The server unlists on revoke, so the local row does too.
		setShares((current) =>
			(current ?? []).map((row) =>
				row.id === share.id ? { ...row, revokedAt, listed: false } : row
			)
		);
		void (async () => {
			try {
				await revokeShare(getToken, share.id);
			} catch (error) {
				if (!activeRef.current) return;
				setShares((current) =>
					(current ?? []).map((row) =>
						row.id === share.id
							? { ...row, revokedAt: share.revokedAt, listed: share.listed }
							: row
					)
				);
				Alert.alert(
					"Couldn't revoke that link",
					error instanceof Error && error.message
						? error.message
						: "The link is still public. Check your connection and try again."
				);
			} finally {
				if (activeRef.current) setRevokingId(null);
			}
		})();
	};

	/** Optimistic, like revoke: the switch moves on the tap and snaps back on failure. */
	const applyListed = (share: SharedAnswerSummary, listed: boolean) => {
		if (listingId || revokingId) return;
		setListingId(share.id);
		setShares((current) =>
			(current ?? []).map((row) => (row.id === share.id ? { ...row, listed } : row))
		);
		void (async () => {
			try {
				await setShareListed(getToken, share.id, listed);
			} catch (error) {
				if (!activeRef.current) return;
				setShares((current) =>
					(current ?? []).map((row) =>
						row.id === share.id ? { ...row, listed: share.listed } : row
					)
				);
				Alert.alert(
					listed ? "Couldn't show that answer in search" : "Couldn't hide that answer from search",
					error instanceof Error && error.message
						? error.message
						: "Nothing changed. Check your connection and try again."
				);
			} finally {
				if (activeRef.current) setListingId(null);
			}
		})();
	};

	/** Turning it on makes the answer findable by strangers, so it asks first; off never does. */
	const toggleListed = (share: SharedAnswerSummary, next: boolean) => {
		if (listingId || revokingId || share.revokedAt) return;
		if (!next) {
			applyListed(share, false);
			return;
		}
		Alert.alert(LIST_CONFIRM_TITLE, LIST_CONFIRM_MESSAGE, [
			{ text: "Cancel", style: "cancel" },
			{ text: "Show in search", onPress: () => applyListed(share, true) },
		]);
	};

	return (
		<>
			{hideHeading ? null : <Text style={styles.sectionLabel}>SHARED ANSWERS</Text>}
			<GlassCard style={styles.card}>
				<Text style={styles.hint}>{DESCRIPTION}</Text>

				{shares === null ? (
					<View style={styles.stateRow}>
						<Text style={styles.hint}>
							{failed ? "Couldn't load your shared answers." : "Loading your shared answers…"}
						</Text>
						{failed ? (
							loading ? (
								<ActivityIndicator size="small" color={colors.accent} />
							) : (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel="Retry loading your shared answers"
									onPress={() => void load()}
									hitSlop={8}
									style={({ pressed }) => [
										styles.retryButton,
										pressed && { backgroundColor: colors.surfacePressed },
									]}
								>
									<Text style={styles.retryLabel}>Retry</Text>
								</Pressable>
							)
						) : (
							<ActivityIndicator size="small" color={colors.accent} />
						)}
					</View>
				) : shares.length === 0 ? (
					<View style={styles.stateRow}>
						<Text style={styles.hint}>{EMPTY}</Text>
					</View>
				) : (
					shares.map((share) => {
						const revoked = Boolean(share.revokedAt);
						const switchDisabled = listingId !== null || revokingId !== null;
						const revokeDisabled = revokingId !== null || listingId === share.id;
						return (
							<View key={share.id} style={styles.shareRow}>
								<View style={styles.shareText}>
									<Text style={styles.question} numberOfLines={2}>
										{share.question.trim() || UNTITLED}
									</Text>
									<View style={styles.metaRow}>
										<Text style={styles.meta}>
											{copiedId === share.id ? "Link copied" : relativeTime(share.createdAt)}
										</Text>
										{revoked && (
											<View style={styles.revokedTag}>
												<Text style={styles.revokedLabel}>Revoked</Text>
											</View>
										)}
									</View>
								</View>

								{!revoked && (
									<Pressable
										accessibilityRole="switch"
										accessibilityLabel="Show this answer in search"
										accessibilityState={{
											checked: share.listed,
											disabled: switchDisabled,
										}}
										disabled={switchDisabled}
										onPress={() => toggleListed(share, !share.listed)}
										style={({ pressed }) => [
											styles.searchRow,
											pressed && { backgroundColor: colors.surfacePressed },
										]}
									>
										<Text style={styles.searchLabel}>Show in search</Text>
										<Switch
											importantForAccessibility="no-hide-descendants"
											accessibilityElementsHidden
											value={share.listed}
											disabled={switchDisabled}
											onValueChange={(next) => toggleListed(share, next)}
											trackColor={{ false: colors.surfacePressed, true: colors.accentSoft }}
											thumbColor={share.listed ? colors.accent : colors.textFaint}
										/>
									</Pressable>
								)}

								{!revoked && (
									<View style={styles.actions}>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="Copy this share link"
											onPress={() => copy(share)}
											style={({ pressed }) => [
												styles.actionButton,
												pressed && { backgroundColor: colors.surfacePressed },
											]}
										>
											<Text style={styles.actionLabel}>Copy link</Text>
										</Pressable>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel="Revoke this share link"
											disabled={revokeDisabled}
											onPress={() => revoke(share)}
											style={({ pressed }) => [
												styles.actionButton,
												revokeDisabled && styles.actionDisabled,
												pressed && { backgroundColor: colors.dangerSoft },
											]}
										>
											<Text style={[styles.actionLabel, styles.revokeLabel]}>Revoke</Text>
										</Pressable>
									</View>
								)}
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
		retryButton: {
			minWidth: 64,
			minHeight: 44,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		retryLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		shareRow: {
			gap: spacing.sm,
			padding: spacing.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
		},
		shareText: { gap: 4 },
		question: { color: c.text, ...typography.control },
		metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		meta: { color: c.textFaint, ...typography.micro },
		revokedTag: {
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.dangerBorder,
			backgroundColor: c.dangerSoft,
		},
		revokedLabel: { color: c.danger, ...typography.micro, fontWeight: "700" },
		searchRow: {
			minHeight: 44,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.md,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.md,
		},
		searchLabel: { flex: 1, color: c.text, ...typography.control, fontWeight: "600" },
		actions: { flexDirection: "row", gap: spacing.sm },
		actionButton: {
			minHeight: 44,
			paddingHorizontal: spacing.md,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.md,
		},
		actionLabel: { color: c.accent, ...typography.meta, fontWeight: "700" },
		revokeLabel: { color: c.danger },
		actionDisabled: { opacity: 0.4 },
	});

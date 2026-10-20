import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { resolveReference } from "@/features/bible/books";
import { connectionSectionOf, parseConnectionExplanation } from "@/features/bible/connectionsMap";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import type { ExplainStatus } from "./useConnectionsExplain";

interface ExplainSheetProps {
	visible: boolean;
	reference: string;
	sectionLabel: string | null;
	status: ExplainStatus;
	text: string;
	error: string | null;
	onClose: () => void;
	onRetry: () => void;
	onOpenReference: (reference: string) => void;
	onContinueInChat: () => void;
}

/**
 * The short, separate answer to "Ask why these connect": the thread through
 * the passages, then one tagged card per passage explaining its link, so the
 * reader learns the why without leaving the map for a full chat.
 */
export function ExplainSheet({
	visible,
	reference,
	sectionLabel,
	status,
	text,
	error,
	onClose,
	onRetry,
	onOpenReference,
	onContinueInChat,
}: ExplainSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const parsed = useMemo(() => parseConnectionExplanation(text, status === "done"), [text, status]);
	const busy = status === "loading" || status === "streaming";

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Why these connect" scroll>
			<View style={styles.body}>
				<Text style={styles.reference}>
					{reference}
					{sectionLabel ? <Text style={styles.scope}>{`  ·  ${sectionLabel}`}</Text> : null}
				</Text>
				{status === "error" ? (
					<View style={styles.errorBox}>
						<Text style={styles.errorText}>{error ?? "These connections could not be explained."}</Text>
						<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
							<Text style={styles.retry}>Try again</Text>
						</Pressable>
					</View>
				) : null}
				{status === "loading" ? (
					<View style={styles.loading}>
						<ActivityIndicator color={colors.accent} />
						<Text style={styles.muted}>Tracing the links through Scripture…</Text>
					</View>
				) : null}
				{parsed.summary ? <Text style={styles.summary}>{parsed.summary}</Text> : null}
				{parsed.items.map((item) => {
					const target = resolveReference(item.reference.split(/[--]/, 1)[0]);
					const section = target ? connectionSectionOf(target.order) : null;
					return (
						<Pressable
							key={item.reference}
							accessibilityRole="button"
							accessibilityLabel={`Open ${item.reference}`}
							disabled={!target}
							onPress={() => onOpenReference(item.reference)}
							style={({ pressed }) => [styles.card, pressed && styles.pressed]}
						>
							<View style={styles.cardHead}>
								{section ? <View style={[styles.dot, { backgroundColor: section.color }]} /> : null}
								<Text style={styles.cardRef}>{item.reference}</Text>
								{section ? (
									<View style={[styles.tag, { borderColor: `${section.color}88` }]}>
										<Text style={[styles.tagText, { color: section.color }]}>{section.label}</Text>
									</View>
								) : null}
							</View>
							<Text style={styles.cardText}>{item.text}</Text>
						</Pressable>
					);
				})}
				{busy && parsed.items.length > 0 ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
				{status === "done" ? (
					<Pressable
						accessibilityRole="button"
						onPress={onContinueInChat}
						style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
					>
						<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
						<Text style={styles.chatLabel}>Keep studying this in chat</Text>
					</Pressable>
				) : null}
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		body: { paddingHorizontal: spacing.lg, gap: spacing.md },
		reference: { color: c.accent, ...typography.support, fontFamily: fonts.bodyBold, letterSpacing: 0.6 },
		scope: { color: c.textMuted, fontFamily: fonts.body },
		loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
		muted: { color: c.textMuted, ...typography.support },
		summary: { color: c.text, fontFamily: fonts.verse, fontSize: 21, lineHeight: 29 },
		card: {
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			padding: spacing.md,
			gap: 6,
		},
		pressed: { backgroundColor: c.surfacePressed },
		cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		dot: { width: 8, height: 8, borderRadius: 4 },
		cardRef: { flex: 1, color: c.text, ...typography.control, fontFamily: fonts.bodyBold },
		tag: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
		tagText: { ...typography.micro, fontFamily: fonts.bodyBold },
		cardText: { color: c.textSecondary, ...typography.support },
		more: { paddingVertical: spacing.sm },
		errorBox: { gap: spacing.sm, paddingVertical: spacing.sm },
		errorText: { color: c.danger, ...typography.support },
		retry: { color: c.accent, ...typography.support, fontFamily: fonts.bodyBold },
		chatButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			minHeight: 48,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
			marginTop: spacing.sm,
		},
		chatLabel: { color: c.accent, ...typography.control, fontFamily: fonts.bodyBold },
	});

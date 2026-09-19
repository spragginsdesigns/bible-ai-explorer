import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { GlassCard } from "@/components/ui";
import { apiJson, type GetToken } from "@/lib/api";
import {
	FEEDBACK_CATEGORIES,
	MAX_FEEDBACK_MESSAGE_LENGTH,
	looksLikeEmail,
	type FeedbackCategoryId,
} from "@/lib/inAppFeedback";
import { useTheme, useThemedStyles } from "./settingsStore";
import { radius, spacing, typography, type Colors } from "@/theme";

/**
 * Settings -> Send feedback (docs/FEATURES.md, "Send feedback").
 *
 * The Android twin of `src/components/settings/FeedbackSection.tsx`. Android
 * is the primary client, so this is the copy that matters most: it is the only
 * place a person using the app on their phone can answer back in words rather
 * than by leaving.
 *
 * It asks for as little as possible around the message. The version is
 * attached without asking, because "it broke" is unanswerable without knowing
 * which build broke.
 */

const APP_VERSION = Constants.expoConfig?.version ?? null;

export function FeedbackSection({ getToken }: { getToken: GetToken }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [category, setCategory] = useState<FeedbackCategoryId>("bug");
	const [message, setMessage] = useState("");
	const [replyEmail, setReplyEmail] = useState("");
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const send = async () => {
		const trimmed = message.trim();
		if (sendingRef.current || trimmed.length === 0) return;
		const email = replyEmail.trim();
		if (email.length > 0 && !looksLikeEmail(email)) {
			setError("That email address does not look right.");
			return;
		}

		sendingRef.current = true;
		setSending(true);
		setError(null);
		try {
			await apiJson<{ id: string }>(getToken, "/api/feedback", {
				method: "POST",
				body: {
					category,
					message: trimmed,
					...(APP_VERSION ? { appVersion: APP_VERSION } : {}),
					...(email ? { replyEmail: email } : {}),
				},
			});
			setSent(true);
			setMessage("");
			setReplyEmail("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send that. Try again.");
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	};

	if (sent) {
		return (
			<GlassCard style={styles.card}>
				<Text style={styles.thanks}>
					Thank you. That went straight through, and it is read by a person rather than counted
					by a machine.
				</Text>
				<Pressable
					accessibilityRole="button"
					onPress={() => setSent(false)}
					style={({ pressed }) => [
						styles.secondaryButton,
						pressed && { backgroundColor: colors.surfacePressed },
					]}
				>
					<Text style={styles.secondaryLabel}>Send something else</Text>
				</Pressable>
			</GlassCard>
		);
	}

	return (
		<GlassCard style={styles.card}>
			<Text style={styles.hint}>
				Tell us what is broken, what is missing, or what you would want SureWord to do. A person
				reads every one of these.
			</Text>

			<View style={styles.chips}>
				{FEEDBACK_CATEGORIES.map((option) => {
					const active = option.id === category;
					return (
						<Pressable
							key={option.id}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
							onPress={() => setCategory(option.id)}
							style={({ pressed }) => [
								styles.chip,
								active && styles.chipActive,
								pressed && { opacity: 0.82 },
							]}
						>
							<Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
								{option.label}
							</Text>
						</Pressable>
					);
				})}
			</View>

			<TextInput
				value={message}
				onChangeText={(value) => {
					setMessage(value);
					setError(null);
				}}
				maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
				placeholder="The Listen button never finished loading for me this morning…"
				placeholderTextColor={colors.textFaint}
				selectionColor={colors.accent}
				accessibilityLabel="Your feedback"
				multiline
				textAlignVertical="top"
				style={styles.input}
			/>

			<TextInput
				value={replyEmail}
				onChangeText={(value) => {
					setReplyEmail(value);
					setError(null);
				}}
				placeholder="Email, only if you want a reply"
				placeholderTextColor={colors.textFaint}
				selectionColor={colors.accent}
				accessibilityLabel="Email, only if you want a reply"
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="email-address"
				style={styles.emailInput}
			/>

			<View style={styles.sendRow}>
				<Text accessibilityLiveRegion="polite" style={[styles.status, error ? styles.error : null]}>
					{error ?? (sending ? "Sending…" : "")}
				</Text>
				<Text style={styles.counter}>{`${message.length} / ${MAX_FEEDBACK_MESSAGE_LENGTH}`}</Text>
				<Pressable
					accessibilityRole="button"
					disabled={sending || message.trim().length === 0}
					onPress={() => void send()}
					style={({ pressed }) => [
						styles.sendButton,
						(sending || message.trim().length === 0) && styles.buttonDisabled,
						pressed && { opacity: 0.82 },
					]}
				>
					<Text style={styles.sendLabel}>{sending ? "Sending…" : "Send"}</Text>
				</Pressable>
			</View>
		</GlassCard>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: { padding: spacing.lg, gap: spacing.md },
		hint: { color: c.textFaint, ...typography.support },
		thanks: { color: c.text, ...typography.control },
		chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
		chip: {
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: spacing.md,
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		chipActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
		chipLabel: { color: c.textMuted, ...typography.meta, fontWeight: "600" },
		chipLabelActive: { color: c.accent, fontWeight: "700" },
		input: {
			minHeight: 120,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			borderRadius: radius.md,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			color: c.text,
			...typography.control,
		},
		emailInput: {
			minHeight: 46,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			borderRadius: radius.md,
			backgroundColor: c.bgElevated,
			paddingHorizontal: spacing.md,
			color: c.text,
			...typography.control,
		},
		sendRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingTop: spacing.sm,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: c.border,
		},
		status: { flex: 1, color: c.textFaint, ...typography.micro },
		counter: { minWidth: 72, textAlign: "right", color: c.textFaint, ...typography.micro },
		error: { color: c.danger },
		sendButton: {
			minHeight: 46,
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			backgroundColor: c.accent,
		},
		sendLabel: { color: "#171717", ...typography.meta, fontWeight: "700" },
		secondaryButton: {
			minHeight: 46,
			alignSelf: "flex-start",
			paddingHorizontal: spacing.lg,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: radius.lg,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
		},
		secondaryLabel: { color: c.text, ...typography.meta, fontWeight: "700" },
		buttonDisabled: { opacity: 0.4 },
	});

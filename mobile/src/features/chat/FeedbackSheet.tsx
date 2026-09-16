import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { BottomSheet } from "@/features/notes/components/primitives";
import { FEEDBACK_REASON_MAX_LENGTH } from "@/lib/answerFeedback";

interface FeedbackSheetProps {
	visible: boolean;
	/** Send only. The thumb itself is already recorded by the time this opens. */
	onSubmit: (reason: string) => void;
	onClose: () => void;
}

/**
 * The optional one line after a thumbs down. Skipping is a first-class answer:
 * the rating is already saved, and this only ever adds the "what went wrong"
 * note a person reads later when deciding whether the answer becomes an eval
 * fixture (docs/FEATURES.md, "Answer feedback").
 */
export function FeedbackSheet({ visible, onSubmit, onClose }: FeedbackSheetProps) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const [reason, setReason] = useState("");

	// Fresh field every time it opens - a reason belongs to one answer.
	useEffect(() => {
		if (visible) setReason("");
	}, [visible]);

	const trimmed = reason.trim();

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Thanks for saying so">
			<Text style={styles.blurb}>
				Tell us what went wrong and it helps us test the answer. Optional.
			</Text>
			<TextInput
				value={reason}
				onChangeText={setReason}
				placeholder="What went wrong? (optional)"
				placeholderTextColor={colors.textGhost}
				maxLength={FEEDBACK_REASON_MAX_LENGTH}
				autoFocus
				returnKeyType="send"
				onSubmitEditing={() => (trimmed ? onSubmit(trimmed) : onClose())}
				style={styles.input}
			/>
			<View style={styles.actions}>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Skip the reason"
					onPress={onClose}
					style={({ pressed }) => [styles.skip, pressed && styles.skipPressed]}
				>
					<Text style={styles.skipLabel}>Skip</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Send the reason"
					accessibilityState={{ disabled: !trimmed }}
					disabled={!trimmed}
					onPress={() => onSubmit(trimmed)}
					style={({ pressed }) => [
						styles.send,
						pressed && styles.sendPressed,
						!trimmed && styles.dimmed,
					]}
				>
					<Text style={styles.sendLabel}>Send</Text>
				</Pressable>
			</View>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		blurb: { ...typography.support, color: c.textFaint, marginBottom: spacing.md },
		input: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 10,
			color: c.text,
			fontSize: 14,
		},
		actions: {
			flexDirection: "row",
			justifyContent: "flex-end",
			alignItems: "center",
			gap: spacing.sm,
			marginTop: spacing.md,
		},
		skip: {
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			borderRadius: radius.md,
		},
		skipPressed: { backgroundColor: c.surfacePressed },
		skipLabel: { color: c.textFaint, fontSize: 14 },
		send: {
			minHeight: 44,
			justifyContent: "center",
			paddingHorizontal: spacing.lg,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		sendPressed: { backgroundColor: c.accentPressed },
		sendLabel: { color: c.accent, fontSize: 14, fontWeight: "600" },
		dimmed: { opacity: 0.5 },
	});
